/**
 * auth/client — authentication and session persistence.
 *
 * ## Owns
 * - Auth token (stored in OS keyring via Rust `get/set/clear_secure_auth_token`)
 * - `AuthSession` (user info, subscription tier, expiry) — serialized to OS keyring
 * - Device UUID (`vocaltype.device.id`) — generated once, persisted to `auth.store.json`
 * - Device registration flag (`vocaltype.device.registered`) — UX-only hint
 * - Registered emails set (`vocaltype.device.registered_emails`) — UX-only hint
 * - Trial welcome flag (`vocaltype.onboarding.trial_shown`)
 *
 * ## Does NOT own
 * - App configuration / shortcuts → see `settingsStore.ts`
 * - Model downloads → see `modelStore.ts`
 *
 * ## Persistence layers
 * | Data | Where |
 * |------|-------|
 * | Token + session | OS keyring (Tauri `keyring` crate) |
 * | Device ID + flags | `auth.store.json` (Tauri store plugin) |
 *
 * The `isDeviceRegistered()` flag is a **UX hint only**. The backend enforces
 * uniqueness via the `device_registrations` table and returns HTTP 409 on
 * duplicate registration attempts.
 */
import type {
  AuthPayload,
  AuthSession,
  BillingLinkResponse,
  ChangePasswordPayload,
  ResetPasswordPayload,
} from "./types";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

const AUTH_TOKEN_KEY = "vocaltype.auth.token";
const AUTH_SESSION_KEY = "vocaltype.auth.session";
const DEVICE_ID_KEY = "vocaltype.device.id";
const DEVICE_REGISTERED_KEY = "vocaltype.device.registered";
// Stores the set of emails that have already been registered on this device.
const REGISTERED_EMAILS_KEY = "vocaltype.device.registered_emails";
const TRIAL_WELCOME_SHOWN_KEY = "vocaltype.onboarding.trial_shown";
const AUTH_STORE_FILE = "auth.store.json";

type PersistedAuthSession = Omit<AuthSession, "token"> & {
  token?: string | null;
};

let cachedToken: string | null = null;
let cachedSession: AuthSession | null = null;
let cachedDeviceId: string | null = null;
let cachedRegisteredEmails: string[] | null = null;
let hasHydratedToken = false;
let storePromise: ReturnType<typeof load> | null = null;

const getSecureAuthToken = () => invoke<string | null>("get_secure_auth_token");
const setSecureAuthToken = (token: string) =>
  invoke<void>("set_secure_auth_token", { token });
const clearSecureAuthToken = () => invoke<void>("clear_secure_auth_token");
const getSecureAuthSession = () =>
  invoke<string | null>("get_secure_auth_session");
const setSecureAuthSession = (sessionJson: string) =>
  invoke<void>("set_secure_auth_session", { sessionJson });
const clearSecureAuthSession = () => invoke<void>("clear_secure_auth_session");

export class AuthApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

const getAuthStore = () => {
  if (!storePromise) {
    storePromise = load(AUTH_STORE_FILE, {
      autoSave: false,
      defaults: {},
    });
  }

  return storePromise;
};

const clearLegacyLocalAuth = () => {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // Ignore localStorage access failures in non-browser contexts.
  }
};

const loadLegacyLocalToken = (): string | null => {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return typeof token === "string" && token.trim() ? token : null;
  } catch {
    return null;
  }
};

const loadLegacyLocalSession = (): PersistedAuthSession | null => {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedAuthSession;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const sanitizeSessionForPersistence = (
  session: AuthSession | PersistedAuthSession,
): PersistedAuthSession => ({
  ...session,
  token: null,
});

const hydratePersistedSession = (
  session: PersistedAuthSession | null,
  token: string | null,
): AuthSession | null => {
  if (!session || !token) {
    return null;
  }

  return {
    ...session,
    token,
  };
};

const readPersistedSessionToken = (
  session: PersistedAuthSession | null,
): string | null => {
  if (!session || typeof session.token !== "string") {
    return null;
  }

  const token = session.token.trim();
  return token ? token : null;
};

// ─── Privacy: device ID hashing ─────────────────────────────────────────────
// We hash the raw device ID with SHA-256 + a fixed application salt before
// sending it to any server. This ensures the server never receives the raw
// hardware identifier, reducing re-identification risk across services.
export async function hashDeviceId(rawId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawId + "vocaltype-salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MACHINE_DEVICE_ID_LENGTH = 64;

const isStableMachineDeviceId = (value: string | null | undefined): boolean =>
  typeof value === "string" &&
  /^[a-f0-9]{64}$/i.test(value.trim()) &&
  value.trim().length === MACHINE_DEVICE_ID_LENGTH;

const loadMachineDeviceId = async (): Promise<string | null> => {
  try {
    const deviceId = await invoke<string>("get_machine_device_id");
    const normalized = deviceId.trim().toLowerCase();
    return isStableMachineDeviceId(normalized) ? normalized : null;
  } catch (error) {
    console.warn("Failed to load machine device ID:", error);
    return null;
  }
};

const getApiBaseUrl = () => {
  const baseUrl = import.meta.env.VITE_AUTH_API_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing VITE_AUTH_API_URL");
  }
  return baseUrl.replace(/\/+$/, "");
};

const buildHeaders = (token?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

const parseError = async (response: Response) => {
  try {
    const data = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return data.error || data.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(token),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new AuthApiError(await parseError(response), response.status);
  }

  return (await response.json()) as T;
}

export const authClient = {
  tokenKey: AUTH_TOKEN_KEY,

  // ─── Device ID ──────────────────────────────────────────────────────────────

  async getOrCreateDeviceId(): Promise<string> {
    if (cachedDeviceId) return cachedDeviceId;

    try {
      const store = await getAuthStore();
      const stored = await store.get<string>(DEVICE_ID_KEY);
      const stableMachineDeviceId = await loadMachineDeviceId();

      if (stableMachineDeviceId) {
        cachedDeviceId = stableMachineDeviceId;
        if (stored !== stableMachineDeviceId) {
          await store.set(DEVICE_ID_KEY, stableMachineDeviceId);
          await store.save();
        }
        return cachedDeviceId;
      }

      if (typeof stored === "string" && stored.trim()) {
        cachedDeviceId = stored.trim();
        return cachedDeviceId;
      }
    } catch {
      // fall through to generate
    }

    // Generate a new UUID for this device and persist it
    const newId = crypto.randomUUID();
    cachedDeviceId = newId;

    try {
      const store = await getAuthStore();
      await store.set(DEVICE_ID_KEY, newId);
      await store.save();
    } catch (error) {
      console.warn("Failed to persist device ID:", error);
    }

    return newId;
  },

  /**
   * Returns whether this device has previously registered an account.
   *
   * UX HINT ONLY — not a security gate.
   * The backend is the real authority: it enforces device uniqueness via the
   * device_registrations table and returns HTTP 409 if a second account is attempted.
   * This local flag just avoids showing the register form to users who already have
   * an account, improving UX. It can be bypassed by clearing the store, but the
   * backend 409 will still block the actual registration attempt.
   */
  async isDeviceRegistered(): Promise<boolean> {
    try {
      const store = await getAuthStore();
      const registered = await store.get<boolean>(DEVICE_REGISTERED_KEY);
      return registered === true;
    } catch {
      return false;
    }
  },

  async markDeviceRegistered(): Promise<void> {
    try {
      const store = await getAuthStore();
      await store.set(DEVICE_REGISTERED_KEY, true);
      await store.save();
    } catch (error) {
      console.warn("Failed to mark device as registered:", error);
    }
  },

  async clearDeviceRegistration(): Promise<void> {
    try {
      const store = await getAuthStore();
      await store.delete(DEVICE_REGISTERED_KEY);
      await store.save();
    } catch (error) {
      console.warn("Failed to clear device registration:", error);
    }
  },

  /** Returns the list of emails already registered on this device. */
  async getRegisteredEmails(): Promise<string[]> {
    if (cachedRegisteredEmails !== null) return cachedRegisteredEmails;
    try {
      const store = await getAuthStore();
      const stored = await store.get<string[]>(REGISTERED_EMAILS_KEY);
      cachedRegisteredEmails = Array.isArray(stored) ? stored : [];
    } catch {
      cachedRegisteredEmails = [];
    }
    return cachedRegisteredEmails;
  },

  /** Returns true if this exact email was used to register on this device before. */
  async isEmailRegisteredOnDevice(email: string): Promise<boolean> {
    const emails = await authClient.getRegisteredEmails();
    return emails.includes(email.trim().toLowerCase());
  },

  /** Saves an email to the device's registered email list. */
  async addRegisteredEmail(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const emails = await authClient.getRegisteredEmails();
    if (!emails.includes(normalized)) {
      const updated = [...emails, normalized];
      cachedRegisteredEmails = updated;
      try {
        const store = await getAuthStore();
        await store.set(REGISTERED_EMAILS_KEY, updated);
        await store.save();
      } catch (error) {
        console.warn("Failed to persist registered emails:", error);
      }
    }
  },

  // ─── Token & Session ────────────────────────────────────────────────────────

  async hydrateStoredToken() {
    if (hasHydratedToken) {
      return cachedToken;
    }

    try {
      const legacyToken = loadLegacyLocalToken();
      const store = await getAuthStore();
      const storedToken = await store.get<string>(AUTH_TOKEN_KEY);
      const secureToken = await getSecureAuthToken();
      const resolvedToken =
        typeof secureToken === "string" && secureToken.trim()
          ? secureToken
          : typeof storedToken === "string" && storedToken.trim()
            ? storedToken
            : legacyToken;

      cachedToken = resolvedToken ?? null;

      if (resolvedToken) {
        await setSecureAuthToken(resolvedToken);
      }

      await store.delete(AUTH_TOKEN_KEY);
      await store.save();
      clearLegacyLocalAuth();
    } catch (error) {
      console.warn(
        "Failed to hydrate auth token from persistent store:",
        error,
      );
      cachedToken = null;
    }

    hasHydratedToken = true;
    return cachedToken;
  },

  async hydrateStoredSession() {
    await this.hydrateStoredToken();

    try {
      const legacySession = loadLegacyLocalSession();
      const store = await getAuthStore();
      const storedSession =
        (await store.get<PersistedAuthSession>(AUTH_SESSION_KEY)) ?? null;
      const secureSessionRaw = await getSecureAuthSession();
      const secureSession = secureSessionRaw
        ? (JSON.parse(secureSessionRaw) as AuthSession)
        : null;
      const resolvedSession = secureSession ?? storedSession ?? legacySession;

      const persistedSession = storedSession
        ? sanitizeSessionForPersistence(storedSession)
        : null;
      const migratedSessionToken =
        readPersistedSessionToken(storedSession) ??
        readPersistedSessionToken(legacySession);

      cachedSession =
        secureSession ??
        hydratePersistedSession(
          persistedSession ??
            (legacySession
              ? sanitizeSessionForPersistence(legacySession)
              : null),
          cachedToken ?? migratedSessionToken,
        );

      if (resolvedSession) {
        let sessionToPersist: AuthSession | null = null;
        if (secureSession) {
          sessionToPersist = secureSession;
        } else {
          sessionToPersist = hydratePersistedSession(
            sanitizeSessionForPersistence(resolvedSession),
            cachedToken ?? migratedSessionToken,
          );
        }

        if (sessionToPersist) {
          cachedSession = sessionToPersist;
          await setSecureAuthSession(JSON.stringify(sessionToPersist));
        }
      }

      await store.delete(AUTH_SESSION_KEY);
      await store.save();
      clearLegacyLocalAuth();
    } catch (error) {
      console.warn(
        "Failed to hydrate auth session from persistent store:",
        error,
      );
      cachedSession = null;
    }

    return cachedSession;
  },

  getStoredToken() {
    return cachedToken;
  },

  getStoredSession() {
    return cachedSession;
  },

  async setStoredSession(session: AuthSession) {
    cachedSession = session;
    await this.setStoredToken(session.token);

    try {
      await setSecureAuthSession(JSON.stringify(session));
      const store = await getAuthStore();
      await store.delete(AUTH_SESSION_KEY);
      await store.save();
    } catch (error) {
      console.warn("Failed to persist auth session:", error);
    }
  },

  async setStoredToken(token: string) {
    cachedToken = token;
    hasHydratedToken = true;
    clearLegacyLocalAuth();

    try {
      await setSecureAuthToken(token);
      const store = await getAuthStore();
      await store.delete(AUTH_TOKEN_KEY);
      await store.save();
    } catch (error) {
      console.warn("Failed to persist auth token:", error);
    }
  },

  async clearStoredSession() {
    cachedSession = null;
    cachedDeviceId = null;
    cachedRegisteredEmails = null;
    clearLegacyLocalAuth();
    await this.clearStoredToken();

    try {
      await clearSecureAuthSession();
      const store = await getAuthStore();
      await store.delete(AUTH_SESSION_KEY);
      await store.save();
    } catch (error) {
      console.warn("Failed to clear persisted auth session:", error);
    }
  },

  async clearStoredToken() {
    cachedToken = null;
    hasHydratedToken = true;
    clearLegacyLocalAuth();

    try {
      await clearSecureAuthToken();
      const store = await getAuthStore();
      await store.delete(AUTH_TOKEN_KEY);
      await store.save();
    } catch (error) {
      console.warn("Failed to clear persisted auth token:", error);
    }
  },

  getErrorStatus(error: unknown) {
    return error instanceof AuthApiError ? error.status : null;
  },

  async hasSeenTrialWelcome(): Promise<boolean> {
    try {
      const store = await getAuthStore();
      return (await store.get<boolean>(TRIAL_WELCOME_SHOWN_KEY)) === true;
    } catch {
      return false;
    }
  },

  async markTrialWelcomeSeen(): Promise<void> {
    try {
      const store = await getAuthStore();
      await store.set(TRIAL_WELCOME_SHOWN_KEY, true);
      await store.save();
    } catch (error) {
      console.warn("Failed to persist trial welcome flag:", error);
    }
  },

  // ─── API Calls ──────────────────────────────────────────────────────────────

  async login(payload: AuthPayload) {
    const rawDeviceId = await authClient.getOrCreateDeviceId();
    const device_id = await hashDeviceId(rawDeviceId);
    return request<AuthSession>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ ...payload, device_id }),
      },
      undefined,
    );
  },

  async register(payload: AuthPayload) {
    const rawDeviceId = await authClient.getOrCreateDeviceId();
    const device_id = await hashDeviceId(rawDeviceId);
    const session = await request<AuthSession>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ ...payload, device_id }),
      },
      undefined,
    );
    // After a successful registration, remember this device and email locally
    await authClient.markDeviceRegistered();
    await authClient.addRegisteredEmail(payload.email);
    return session;
  },

  async getSession(token: string) {
    const session = await request<AuthSession>(
      "/auth/session",
      { method: "GET" },
      token,
    );
    // If the backend returns a refreshed token, persist it automatically
    if (session.token && session.token !== token) {
      await authClient.setStoredToken(session.token);
    }
    return session;
  },

  async createCheckout(token: string) {
    return request<BillingLinkResponse>(
      "/billing/checkout",
      { method: "POST" },
      token,
    );
  },

  async createPortal(token: string) {
    return request<BillingLinkResponse>(
      "/billing/portal",
      { method: "POST" },
      token,
    );
  },

  async forgotPassword(email: string): Promise<void> {
    await request<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async verifyResetCode(email: string, code: string): Promise<boolean> {
    const result = await request<{ valid: boolean }>(
      "/auth/verify-reset-code",
      {
        method: "POST",
        body: JSON.stringify({ email, code }),
      },
    );
    return result.valid;
  },

  async resetPassword(payload: ResetPasswordPayload): Promise<AuthSession> {
    return request<AuthSession>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async changePassword(
    token: string,
    payload: ChangePasswordPayload,
  ): Promise<void> {
    await request<{ ok: boolean }>(
      "/auth/change-password",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
};

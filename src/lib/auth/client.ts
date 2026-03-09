import type {
  AuthPayload,
  AuthSession,
  BillingLinkResponse,
} from "./types";
import { load } from "@tauri-apps/plugin-store";

const AUTH_TOKEN_KEY = "vocaltype.auth.token";
const AUTH_STORE_FILE = "auth.store.json";

let cachedToken: string | null = null;
let hasHydratedToken = false;
let storePromise: ReturnType<typeof load> | null = null;

const getAuthStore = () => {
  if (!storePromise) {
    storePromise = load(AUTH_STORE_FILE, {
      autoSave: false,
      defaults: {},
    });
  }

  return storePromise;
};

const readLocalToken = () => localStorage.getItem(AUTH_TOKEN_KEY);

const writeLocalToken = (token: string | null) => {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }

  localStorage.removeItem(AUTH_TOKEN_KEY);
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
    const data = (await response.json()) as { error?: string; message?: string };
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
    throw new Error(await parseError(response));
  }

  return (await response.json()) as T;
}

export const authClient = {
  tokenKey: AUTH_TOKEN_KEY,
  async hydrateStoredToken() {
    if (hasHydratedToken) {
      return cachedToken;
    }

    const localToken = readLocalToken();

    try {
      const store = await getAuthStore();
      const storedToken = await store.get<string>(AUTH_TOKEN_KEY);
      const resolvedToken =
        typeof storedToken === "string" && storedToken.trim()
          ? storedToken
          : localToken;

      cachedToken = resolvedToken ?? null;
      writeLocalToken(cachedToken);

      if (!storedToken && localToken) {
        await store.set(AUTH_TOKEN_KEY, localToken);
        await store.save();
      }
    } catch (error) {
      console.warn("Failed to hydrate auth token from persistent store:", error);
      cachedToken = localToken;
    }

    hasHydratedToken = true;
    return cachedToken;
  },
  getStoredToken() {
    return cachedToken ?? readLocalToken();
  },
  async setStoredToken(token: string) {
    cachedToken = token;
    hasHydratedToken = true;
    writeLocalToken(token);

    try {
      const store = await getAuthStore();
      await store.set(AUTH_TOKEN_KEY, token);
      await store.save();
    } catch (error) {
      console.warn("Failed to persist auth token:", error);
    }
  },
  async clearStoredToken() {
    cachedToken = null;
    hasHydratedToken = true;
    writeLocalToken(null);

    try {
      const store = await getAuthStore();
      await store.delete(AUTH_TOKEN_KEY);
      await store.save();
    } catch (error) {
      console.warn("Failed to clear persisted auth token:", error);
    }
  },
  async login(payload: AuthPayload) {
    return request<AuthSession>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      undefined,
    );
  },
  async register(payload: AuthPayload) {
    return request<AuthSession>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      undefined,
    );
  },
  async getSession(token: string) {
    return request<AuthSession>("/auth/session", { method: "GET" }, token);
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
};

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { authClient, AuthApiError, hashDeviceId } from "@/lib/auth/client";
import type {
  IntegritySnapshot,
  LicenseEnvelope,
  LicenseRuntimeState,
  StoredLicenseBundle,
} from "./types";

const getApiBaseUrl = () => {
  const baseUrl = import.meta.env.VITE_AUTH_API_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing VITE_AUTH_API_URL");
  }
  return baseUrl.replace(/\/+$/, "");
};

const buildHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const parseError = async (response: Response) => {
  try {
    const data = (await response.json()) as {
      error?: string;
      message?: string;
      license?: { state?: string };
    };
    return data.error || data.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

async function getAppVersionSafe() {
  try {
    return await getVersion();
  } catch {
    return "unknown";
  }
}

/**
 * Sanitize the integrity snapshot before sending it to the server.
 *
 * The snapshot is used solely for detecting binary tampering.
 * Fields that may contain user-identifiable information are stripped:
 *   - executable_path  (may contain the OS username in the file path)
 *
 * Fields that ARE sent (no personal data):
 *   - release_build    (boolean — is this a release or debug build)
 *   - binary_sha256    (hash of the application binary — detects tampering)
 *   - tamper_flags     (list of integrity anomaly codes — no user data)
 */
function sanitizeIntegrityForServer(
  snapshot: IntegritySnapshot,
): Omit<IntegritySnapshot, "executable_path"> {
  const { executable_path: _executable_path, ...safe } = snapshot;
  return safe;
}

async function postLicense(
  path: string,
  token: string,
): Promise<StoredLicenseBundle> {
  const rawDeviceId = await authClient.getOrCreateDeviceId();
  const device_id = await hashDeviceId(rawDeviceId);
  const app_version = await getAppVersionSafe();
  const app_channel = import.meta.env.DEV ? "dev" : "stable";
  const rawIntegrity = await licenseClient.getIntegritySnapshot();
  // Strip sensitive fields (executable_path may contain the OS username)
  const integrity = sanitizeIntegrityForServer(rawIntegrity);
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({ device_id, app_version, app_channel, integrity }),
  });

  if (!response.ok) {
    const message = await parseError(response);
    throw new AuthApiError(message, response.status);
  }

  const data = (await response.json()) as LicenseEnvelope;
  const bundle = {
    ...data.license,
    last_refreshed_at: new Date().toISOString(),
    app_version,
    app_channel,
  };
  await licenseClient.setStoredBundle(bundle);
  return bundle;
}

export const licenseClient = {
  async getStoredBundle(): Promise<StoredLicenseBundle | null> {
    try {
      const raw = await invoke<string | null>("get_secure_license_bundle");
      if (!raw) return null;
      return JSON.parse(raw) as StoredLicenseBundle;
    } catch (error) {
      console.warn("Failed to load secure license bundle:", error);
      return null;
    }
  },

  async setStoredBundle(bundle: StoredLicenseBundle): Promise<void> {
    try {
      await invoke("set_secure_license_bundle", {
        bundleJson: JSON.stringify(bundle),
      });
    } catch (error) {
      console.warn("Failed to persist secure license bundle:", error);
    }
  },

  async clearStoredBundle(): Promise<void> {
    try {
      await invoke("clear_secure_license_bundle");
    } catch (error) {
      console.warn("Failed to clear secure license bundle:", error);
    }
  },

  async getRuntimeState(): Promise<LicenseRuntimeState> {
    return invoke<LicenseRuntimeState>("get_license_runtime_state");
  },

  async getIntegritySnapshot(): Promise<IntegritySnapshot> {
    return invoke<IntegritySnapshot>("get_integrity_snapshot");
  },

  async issue(token: string): Promise<StoredLicenseBundle> {
    return postLicense("/license/issue", token);
  },

  async refresh(token: string): Promise<StoredLicenseBundle> {
    return postLicense("/license/refresh", token);
  },

  async heartbeat(token: string): Promise<StoredLicenseBundle> {
    return postLicense("/license/heartbeat", token);
  },

  async status(token: string): Promise<LicenseRuntimeState> {
    const rawDeviceId = await authClient.getOrCreateDeviceId();
    const device_id = await hashDeviceId(rawDeviceId);
    const response = await fetch(
      `${getApiBaseUrl()}/license/status?device_id=${encodeURIComponent(device_id)}`,
      {
        method: "GET",
        headers: buildHeaders(token),
      },
    );

    if (!response.ok) {
      throw new AuthApiError(await parseError(response), response.status);
    }

    const data = (await response.json()) as {
      license: LicenseRuntimeState;
    };
    return data.license;
  },

  async reportAnomaly(
    token: string,
    anomalyType: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const rawDeviceId = await authClient.getOrCreateDeviceId();
    const device_id = await hashDeviceId(rawDeviceId);
    await fetch(`${getApiBaseUrl()}/license/report-anomaly`, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify({
        device_id,
        anomaly_type: anomalyType,
        details,
      }),
    });
  },
};

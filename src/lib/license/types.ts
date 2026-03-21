export type LicenseState = "online_valid" | "offline_valid" | "expired";

export interface StoredLicenseBundle {
  state: LicenseState;
  issued_at: string;
  grant_token: string;
  grant_expires_at: string;
  offline_token: string;
  offline_expires_at: string;
  refresh_after_seconds: number;
  device_id: string;
  plan: string;
  entitlements: string[];
  entitlement_status: string;
  model_unlock_key: string;
  build_binding_sha256?: string | null;
  integrity_anomalies?: string[];
  grace_until?: string | null;
  last_refreshed_at?: string | null;
  app_version?: string | null;
  app_channel?: string | null;
}

export interface LicenseEnvelope {
  license: StoredLicenseBundle;
}

export interface LicenseRuntimeState {
  state: LicenseState;
  reason?: string | null;
  device_id?: string | null;
  grant_expires_at?: string | null;
  offline_expires_at?: string | null;
  grace_until?: string | null;
  entitlement_status?: string | null;
  last_refreshed_at?: string | null;
  integrity_anomalies?: string[];
}

/**
 * IntegritySnapshot — collected locally to detect binary tampering.
 *
 * Fields sent to the server (after sanitization in license/client.ts):
 *   - release_build    boolean, no personal data
 *   - binary_sha256    hash of the app binary, no personal data
 *   - tamper_flags     anomaly codes, no personal data
 *
 * Fields NOT sent to the server:
 *   - executable_path  stripped before transmission — may contain the OS
 *                      username embedded in the file path
 */
export interface IntegritySnapshot {
  release_build: boolean;
  binary_sha256?: string | null;
  tamper_flags: string[];
  /** Local only — MUST be stripped before sending to any server. */
  executable_path?: string | null;
}

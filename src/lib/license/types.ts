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

export interface IntegritySnapshot {
  release_build: boolean;
  binary_sha256?: string | null;
  tamper_flags: string[];
  executable_path?: string | null;
}

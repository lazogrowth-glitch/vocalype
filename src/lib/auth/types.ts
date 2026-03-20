export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "inactive";

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export type SubscriptionTier = "premium" | "basic";

export interface WeeklyQuota {
  count: number;
  limit: number;
  remaining: number;
  reset_at: string | null;
}

export interface SubscriptionAccess {
  status: SubscriptionStatus;
  trial_ends_at?: string | null;
  current_period_ends_at?: string | null;
  has_access: boolean;
  tier: SubscriptionTier;
  quota?: WeeklyQuota | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  subscription: SubscriptionAccess;
  show_trial_reminder?: boolean;
}

export interface AuthPayload {
  email: string;
  password: string;
  name?: string;
  device_id?: string;
}

export interface BillingLinkResponse {
  url: string;
}

export interface ResetPasswordPayload {
  email: string;
  code: string;
  new_password: string;
}

export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
}

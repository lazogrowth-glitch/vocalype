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
  can_manage_billing?: boolean;
  quota?: WeeklyQuota | null;
}

export interface AuthSession {
  token: string;
  refresh_token?: string | null;
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

export interface ReferralCode {
  code: string;
  referral_url: string;
}

export interface ReferralStats {
  referral_count: number;
  converted_count: number;
  earned_months: number;
}

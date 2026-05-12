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
export type BillingPlan = "independent" | "power_user";
export type BillingInterval = "monthly" | "yearly";

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
  plan?: BillingPlan | "small_agency" | null;
  billing_plan?: BillingPlan | "small_agency" | null;
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

export interface BillingCheckoutRequest {
  plan?: BillingPlan;
  interval?: BillingInterval;
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

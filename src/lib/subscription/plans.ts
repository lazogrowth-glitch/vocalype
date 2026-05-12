import type { AuthSession, BillingPlan } from "@/lib/auth/types";

export type AppPlan = "basic" | "independent" | "power_user" | "small_agency";
export type ExportFormat = "txt" | "csv" | "md" | "json";

export type PlanCapabilities = {
  plan: AppPlan;
  label: string;
  historyLimit: number | null;
  exportFormats: ExportFormat[];
  maxActionSlots: number;
  allowedTemplateIds: string[] | null;
  canImportAudioFiles: boolean;
  canUseHistoryAiActions: boolean;
  canViewAdvancedStats: boolean;
  hasSharedTemplates: boolean;
  hasSharedDictionary: boolean;
  hasSeatManagement: boolean;
  hasCentralBilling: boolean;
  hasPrioritySupport: boolean;
  hasAdminControls: boolean;
};

const PLAN_CAPABILITIES: Record<AppPlan, PlanCapabilities> = {
  basic: {
    plan: "basic",
    label: "Basic",
    historyLimit: 5,
    exportFormats: [],
    maxActionSlots: 0,
    allowedTemplateIds: [],
    canImportAudioFiles: false,
    canUseHistoryAiActions: false,
    canViewAdvancedStats: false,
    hasSharedTemplates: false,
    hasSharedDictionary: false,
    hasSeatManagement: false,
    hasCentralBilling: false,
    hasPrioritySupport: false,
    hasAdminControls: false,
  },
  independent: {
    plan: "independent",
    label: "Independent",
    historyLimit: 50,
    exportFormats: ["txt"],
    maxActionSlots: 2,
    allowedTemplateIds: [
      "candidate_note",
      "email_candidate",
      "linkedin_message",
    ],
    canImportAudioFiles: false,
    canUseHistoryAiActions: false,
    canViewAdvancedStats: false,
    hasSharedTemplates: false,
    hasSharedDictionary: false,
    hasSeatManagement: false,
    hasCentralBilling: false,
    hasPrioritySupport: false,
    hasAdminControls: false,
  },
  power_user: {
    plan: "power_user",
    label: "Power user",
    historyLimit: null,
    exportFormats: ["txt", "csv", "md", "json"],
    maxActionSlots: 9,
    allowedTemplateIds: null,
    canImportAudioFiles: true,
    canUseHistoryAiActions: true,
    canViewAdvancedStats: true,
    hasSharedTemplates: false,
    hasSharedDictionary: false,
    hasSeatManagement: false,
    hasCentralBilling: false,
    hasPrioritySupport: false,
    hasAdminControls: false,
  },
  small_agency: {
    plan: "small_agency",
    label: "Small agency",
    historyLimit: null,
    exportFormats: ["txt", "csv", "md", "json"],
    maxActionSlots: 9,
    allowedTemplateIds: null,
    canImportAudioFiles: true,
    canUseHistoryAiActions: true,
    canViewAdvancedStats: true,
    hasSharedTemplates: true,
    hasSharedDictionary: true,
    hasSeatManagement: true,
    hasCentralBilling: true,
    hasPrioritySupport: true,
    hasAdminControls: true,
  },
};

export function getPlanCapabilities(plan: AppPlan): PlanCapabilities {
  return PLAN_CAPABILITIES[plan];
}

function normalizePlan(value: unknown): AppPlan | null {
  if (typeof value !== "string") return null;
  switch (value) {
    case "basic":
    case "independent":
    case "power_user":
    case "small_agency":
      return value;
    default:
      return null;
  }
}

export function deriveAppPlan(session: AuthSession | null): AppPlan {
  if (session?.subscription?.tier === "basic") {
    return "basic";
  }

  const explicitPlan = normalizePlan(
    session?.subscription?.plan ?? session?.subscription?.billing_plan,
  );
  if (explicitPlan) {
    return explicitPlan;
  }

  if (session?.subscription?.tier === "premium") {
    return "power_user";
  }

  return "basic";
}

export function planFromCheckoutPlan(
  plan: BillingPlan | "small_agency" | null | undefined,
): AppPlan {
  if (plan === "independent" || plan === "power_user") return plan;
  if (plan === "small_agency") return plan;
  return "basic";
}

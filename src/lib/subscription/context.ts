import { createContext, useContext } from "react";
import type { BillingCheckoutRequest, WeeklyQuota } from "@/lib/auth/types";
import type { AppPlan, PlanCapabilities } from "./plans";
import type { TeamWorkspace } from "./workspace";

export interface PlanContextValue {
  currentPlan: AppPlan;
  capabilities: PlanCapabilities;
  teamWorkspace: TeamWorkspace | null;
  updateTeamWorkspace: (
    updater:
      | TeamWorkspace
      | null
      | ((current: TeamWorkspace | null) => TeamWorkspace | null),
  ) => void;
  isBasicTier: boolean;
  isTrialing: boolean;
  trialEndsAt: string | null;
  quota: WeeklyQuota | null;
  onStartCheckout: (selection?: BillingCheckoutRequest) => Promise<string>;
  openUpgradePlans: () => void;
}

export const PlanContext = createContext<PlanContextValue>({
  currentPlan: "basic",
  capabilities: {
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
  teamWorkspace: null,
  updateTeamWorkspace: () => {},
  isBasicTier: false,
  isTrialing: false,
  trialEndsAt: null,
  quota: null,
  onStartCheckout: async () => "",
  openUpgradePlans: () => {},
});

export function usePlan(): PlanContextValue {
  return useContext(PlanContext);
}

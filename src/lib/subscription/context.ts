import { createContext, useContext } from "react";
import type { BillingCheckoutRequest, WeeklyQuota } from "@/lib/auth/types";

export interface PlanContextValue {
  isBasicTier: boolean;
  isTrialing: boolean;
  trialEndsAt: string | null;
  quota: WeeklyQuota | null;
  onStartCheckout: (selection?: BillingCheckoutRequest) => Promise<string>;
  openUpgradePlans: () => void;
}

export const PlanContext = createContext<PlanContextValue>({
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

import { useCallback, useEffect, useState } from "react";

type OnboardingStep = "consent" | "accessibility" | "model" | "done";

interface UseOnboardingProps {
  authLoading: boolean;
  hasAnyAccess: boolean;
}

export function useOnboarding({
  authLoading,
  hasAnyAccess,
}: UseOnboardingProps) {
  const [onboardingStep, setOnboardingStep] =
    useState<OnboardingStep | null>(null);

  const finishOnboarding = useCallback(() => {
    setOnboardingStep("done");
  }, []);

  useEffect(() => {
    if (authLoading || !hasAnyAccess) {
      setOnboardingStep(null);
      return;
    }

    setOnboardingStep("done");
  }, [authLoading, hasAnyAccess]);

  return {
    onboardingStep,
    isReturningUser: true,
    handleConsentAccepted: finishOnboarding,
    handleAccessibilityComplete: finishOnboarding,
    handleModelSelected: finishOnboarding,
    handleGoBack: finishOnboarding,
  };
}

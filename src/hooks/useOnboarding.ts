import { useCallback, useEffect, useState } from "react";
import { useModelStore } from "@/stores/modelStore";

type OnboardingStep = "first-run" | "done" | null;

interface UseOnboardingProps {
  authLoading: boolean;
  hasAnyAccess: boolean;
}

export function useOnboarding({
  authLoading,
  hasAnyAccess,
}: UseOnboardingProps) {
  const isFirstRun = useModelStore((s) => s.isFirstRun);
  const modelsInitialized = useModelStore((s) => s.initialized);

  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null);

  useEffect(() => {
    if (authLoading || !hasAnyAccess || !modelsInitialized) {
      setOnboardingStep(null);
      return;
    }
    setOnboardingStep(isFirstRun ? "first-run" : "done");
  }, [authLoading, hasAnyAccess, modelsInitialized, isFirstRun]);

  const handleFirstRunComplete = useCallback(() => {
    setOnboardingStep("done");
  }, []);

  return { onboardingStep, handleFirstRunComplete };
}

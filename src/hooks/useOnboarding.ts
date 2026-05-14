import { useCallback, useEffect, useState } from "react";
import { useModelStore } from "@/stores/modelStore";

type OnboardingStep = "first-run" | "done" | null;

interface UseOnboardingProps {
  authLoading: boolean;
  hasAnyAccess: boolean;
}

const FIRST_RUN_COMPLETED_KEY = "vt.firstRunCompleted";

export function useOnboarding({
  authLoading,
  hasAnyAccess,
}: UseOnboardingProps) {
  const isFirstRun = useModelStore((s) => s.isFirstRun);
  const modelsInitialized = useModelStore((s) => s.initialized);

  // Persist completion across auth re-evaluations so the download screen
  // never re-appears after the user finishes onboarding mid-session.
  const [completedFirstRun, setCompletedFirstRun] = useState(() => {
    try {
      return localStorage.getItem(FIRST_RUN_COMPLETED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null);

  useEffect(() => {
    if (authLoading || !hasAnyAccess || !modelsInitialized) {
      setOnboardingStep(null);
      return;
    }
    if (completedFirstRun) {
      setOnboardingStep("done");
      return;
    }
    setOnboardingStep(isFirstRun ? "first-run" : "done");
  }, [
    authLoading,
    hasAnyAccess,
    modelsInitialized,
    isFirstRun,
    completedFirstRun,
  ]);

  const handleFirstRunComplete = useCallback(() => {
    try {
      localStorage.setItem(FIRST_RUN_COMPLETED_KEY, "1");
    } catch {
      // Non-critical
    }
    setCompletedFirstRun(true);
    setOnboardingStep("done");
  }, []);

  return { onboardingStep, handleFirstRunComplete };
}

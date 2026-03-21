import { useCallback, useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";
import { getIdentifier } from "@tauri-apps/api/app";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { commands } from "@/bindings";

type OnboardingStep = "accessibility" | "model" | "done";

interface UseOnboardingProps {
  authLoading: boolean;
  hasAnyAccess: boolean;
}

export function useOnboarding({ authLoading, hasAnyAccess }: UseOnboardingProps) {
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(null);
  const [isReturningUser, setIsReturningUser] = useState(false);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const appIdentifier = await getIdentifier();
      const isDevFlavor = appIdentifier.endsWith(".dev");

      const result = await commands.hasAnyModelsAvailable();
      const hasModels = result.status === "ok" && result.data;

      if (hasModels) {
        setIsReturningUser(true);
        if (platform() === "macos" && !isDevFlavor) {
          try {
            const [hasAccessibility, hasMicrophone] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
            ]);
            if (!hasAccessibility || !hasMicrophone) {
              setOnboardingStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check permissions:", e);
          }
        }
        setOnboardingStep("done");
      } else {
        setIsReturningUser(false);
        setOnboardingStep(isDevFlavor ? "model" : "accessibility");
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setOnboardingStep("accessibility");
    }
  }, []);

  const handleAccessibilityComplete = useCallback(() => {
    setOnboardingStep(isReturningUser ? "done" : "model");
  }, [isReturningUser]);

  const handleModelSelected = useCallback(() => {
    setOnboardingStep("done");
  }, []);

  useEffect(() => {
    if (authLoading || !hasAnyAccess) {
      return;
    }
    checkOnboardingStatus();
  }, [authLoading, hasAnyAccess, checkOnboardingStatus]);

  return {
    onboardingStep,
    isReturningUser,
    handleAccessibilityComplete,
    handleModelSelected,
  };
}

import { useCallback, useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";
import { getIdentifier } from "@tauri-apps/api/app";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { commands } from "@/bindings";
import { load } from "@tauri-apps/plugin-store";

type OnboardingStep = "consent" | "accessibility" | "model" | "done";

const CONSENT_STORE_FILE = "auth.store.json";
const CONSENT_ACCEPTED_KEY = "vocaltype.privacy.consent_accepted";

async function hasAcceptedConsent(): Promise<boolean> {
  try {
    const store = await load(CONSENT_STORE_FILE, {
      autoSave: false,
      defaults: {},
    });
    return (await store.get<boolean>(CONSENT_ACCEPTED_KEY)) === true;
  } catch {
    return false;
  }
}

async function markConsentAccepted(): Promise<void> {
  try {
    const store = await load(CONSENT_STORE_FILE, {
      autoSave: false,
      defaults: {},
    });
    await store.set(CONSENT_ACCEPTED_KEY, true);
    await store.save();
  } catch (e) {
    console.warn("Failed to persist consent flag:", e);
  }
}

interface UseOnboardingProps {
  authLoading: boolean;
  hasAnyAccess: boolean;
}

export function useOnboarding({
  authLoading,
  hasAnyAccess,
}: UseOnboardingProps) {
  const [stepHistory, setStepHistory] = useState<OnboardingStep[]>([]);
  const [isReturningUser, setIsReturningUser] = useState(false);

  const onboardingStep = stepHistory[stepHistory.length - 1] ?? null;

  const pushStep = useCallback((step: OnboardingStep) => {
    setStepHistory((prev) => [...prev, step]);
  }, []);

  const handleGoBack = useCallback(() => {
    setStepHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const appIdentifier = await getIdentifier();
      const isDevFlavor = appIdentifier.endsWith(".dev");

      // Always show consent step first for new users (and returning users who
      // haven't seen it yet — e.g. installed before this policy was added).
      const consentAccepted = await hasAcceptedConsent();
      if (!consentAccepted) {
        pushStep("consent");
        return;
      }

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
              pushStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check permissions:", e);
          }
        }
        pushStep("done");
      } else {
        setIsReturningUser(false);
        pushStep(isDevFlavor ? "model" : "accessibility");
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      pushStep("accessibility");
    }
  }, [pushStep]);

  const handleConsentAccepted = useCallback(async () => {
    await markConsentAccepted();
    // After consent, proceed to check the rest of the onboarding flow
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
              pushStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check permissions:", e);
          }
        }
        pushStep("done");
      } else {
        setIsReturningUser(false);
        pushStep(isDevFlavor ? "model" : "accessibility");
      }
    } catch (error) {
      console.error("Failed to check onboarding status after consent:", error);
      pushStep("accessibility");
    }
  }, [pushStep]);

  const handleAccessibilityComplete = useCallback(() => {
    pushStep(isReturningUser ? "done" : "model");
  }, [isReturningUser, pushStep]);

  const handleModelSelected = useCallback(() => {
    pushStep("done");
  }, [pushStep]);

  useEffect(() => {
    if (authLoading || !hasAnyAccess) {
      return;
    }
    checkOnboardingStatus();
  }, [authLoading, hasAnyAccess, checkOnboardingStatus]);

  return {
    onboardingStep,
    isReturningUser,
    handleConsentAccepted,
    handleAccessibilityComplete,
    handleModelSelected,
    handleGoBack,
  };
}

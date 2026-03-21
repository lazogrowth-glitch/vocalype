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
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  const [isReturningUser, setIsReturningUser] = useState(false);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const appIdentifier = await getIdentifier();
      const isDevFlavor = appIdentifier.endsWith(".dev");

      // Always show consent step first for new users (and returning users who
      // haven't seen it yet — e.g. installed before this policy was added).
      const consentAccepted = await hasAcceptedConsent();
      if (!consentAccepted) {
        setOnboardingStep("consent");
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
      console.error("Failed to check onboarding status after consent:", error);
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
    handleConsentAccepted,
    handleAccessibilityComplete,
    handleModelSelected,
  };
}

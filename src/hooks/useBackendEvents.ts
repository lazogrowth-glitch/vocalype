import { useCallback, useEffect, useRef, type DependencyList } from "react";
import { toast } from "sonner";
import {
  listen,
  type EventCallback,
  type EventName,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { safeUnlisten } from "@/lib/tauri/events";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { useSettingsStore } from "@/stores/settingsStore";
import { LANGUAGES } from "@/lib/constants/languages";

function useTauriEvent<T>(
  event: EventName,
  handler: EventCallback<T>,
  deps: DependencyList = [],
) {
  useEffect(() => {
    let unlistenFn: UnlistenFn | undefined;
    let cancelled = false;
    void listen<T>(event, handler)
      .then((fn) => {
        if (cancelled) {
          try {
            safeUnlisten(fn);
          } catch {
            /* Tauri HMR race — safe to ignore */
          }
        } else {
          unlistenFn = fn;
        }
      })
      .catch(() => {
        /* Listener registration may fail during startup/HMR teardown. */
      });
    return () => {
      cancelled = true;
      try {
        safeUnlisten(unlistenFn);
      } catch {
        /* Tauri HMR race — safe to ignore */
      }
    };
  }, deps);
}
import {
  isSectionVisibleInLaunch,
  type SidebarSection,
} from "@/components/sections-config";
import type { RuntimeErrorEvent } from "@/types/runtimeObservability";
import type { StartupWarmupStatusSnapshot } from "@/types/startupWarmup";
import type { AppSettings } from "@/bindings";

interface UseBackendEventsProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  currentSection: SidebarSection;
  setCurrentSection: (section: SidebarSection) => void;
  settings: AppSettings | null | undefined;
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
}

type TranslateFn = UseBackendEventsProps["t"];

interface ActionableRuntimeMessage {
  key: string;
  defaultValue: string;
}

interface RuntimeHintState {
  count: number;
  windowStartedAt: number;
  lastHintAt: number;
}

interface RuntimeHintMessage {
  key: string;
  defaultValue: string;
}

const RUNTIME_HINT_THRESHOLD = 2;
const RUNTIME_HINT_WINDOW_MS = 10 * 60 * 1000;
const RUNTIME_HINT_COOLDOWN_MS = 20 * 60 * 1000;

const ACTIONABLE_RUNTIME_MESSAGES: Record<string, ActionableRuntimeMessage> = {
  no_model_loaded: {
    key: "errors.actionable.noModelLoaded",
    defaultValue: "No model is loaded. Go to Models and select one.",
  },
  microphone_unavailable: {
    key: "errors.actionable.microphoneUnavailable",
    defaultValue:
      "Microphone could not be accessed. Check your system audio settings.",
  },
  mic_not_found: {
    key: "errors.actionable.microphoneUnavailable",
    defaultValue:
      "Vocalype cannot find that microphone. Choose another input in Settings.",
  },
  mic_permission_denied: {
    key: "errors.actionable.microphonePermissionDenied",
    defaultValue:
      "Microphone permission is blocked. Allow Vocalype in your system privacy settings, then try again.",
  },
  mic_open_failed: {
    key: "errors.actionable.audioCaptureFailed",
    defaultValue:
      "Vocalype could not open the microphone. Try unplugging it or choosing another input in Settings.",
  },
  out_of_memory: {
    key: "errors.actionable.outOfMemory",
    defaultValue: "Not enough memory. Close other applications and try again.",
  },
  audio_capture_failed: {
    key: "errors.actionable.audioCaptureFailed",
    defaultValue:
      "Audio capture failed. Try a different microphone in Settings.",
  },
  no_speech_detected: {
    key: "errors.actionable.noSpeechDetected",
    defaultValue:
      "No usable speech was detected. Try again a little closer to the microphone, or check the selected input.",
  },
  audio_captured_empty_transcript: {
    key: "errors.actionable.audioCapturedEmptyTranscript",
    defaultValue:
      "The microphone picked up audio, but the model returned no text. Try again with a shorter phrase, or switch to a more accurate model.",
  },
  transcription_partial: {
    key: "errors.actionable.transcriptionPartial",
    defaultValue:
      "Only part of the dictation could be recovered. Try a shorter phrase or switch to a more accurate model.",
  },
  transcription_partial_recovered: {
    key: "errors.actionable.transcriptionPartialRecovered",
    defaultValue:
      "Vocalype recovered a partial dictation from the live preview. Check the pasted text before continuing.",
  },
  no_speech_recovered_from_preview: {
    key: "errors.actionable.noSpeechRecoveredFromPreview",
    defaultValue:
      "Vocalype recovered text from the hidden live preview. Check the pasted text before continuing.",
  },
  paste_failed: {
    key: "warnings.pasteFailedDesc",
    defaultValue:
      "The transcription was ready, but Vocalype could not paste it into the active app.",
  },
  paste_main_thread_dispatch_failed: {
    key: "warnings.pasteFailedDesc",
    defaultValue:
      "The transcription was ready, but Vocalype could not paste it into the active app.",
  },
};

const LIMITED_RUNTIME_HINTS: Record<string, RuntimeHintMessage> = {
  no_speech_detected: {
    key: "hints.runtime.noSpeechDetected",
    defaultValue:
      "Tip: if this keeps happening, confirm the selected microphone and try one short sentence close to the mic.",
  },
  audio_captured_empty_transcript: {
    key: "hints.runtime.audioCapturedEmptyTranscript",
    defaultValue:
      "Tip: Vocalype heard audio, so try a shorter phrase or a more accurate model if this repeats.",
  },
  mic_not_found: {
    key: "hints.runtime.micNotFound",
    defaultValue:
      "Tip: reselect your microphone in Settings, especially after unplugging or reconnecting a device.",
  },
  mic_open_failed: {
    key: "hints.runtime.micOpenFailed",
    defaultValue:
      "Tip: another app may be holding the microphone. Close meeting or recorder apps, then try again.",
  },
  mic_permission_denied: {
    key: "hints.runtime.micPermissionDenied",
    defaultValue:
      "Tip: open system privacy settings and allow Vocalype to use the microphone.",
  },
  transcription_partial: {
    key: "hints.runtime.transcriptionPartial",
    defaultValue:
      "Tip: repeated partial results usually improve with shorter dictations or a quality model.",
  },
  paste_failed: {
    key: "hints.runtime.pasteFailed",
    defaultValue:
      "Tip: if paste keeps failing in this app, try another paste method in Settings.",
  },
  paste_main_thread_dispatch_failed: {
    key: "hints.runtime.pasteFailed",
    defaultValue:
      "Tip: if paste keeps failing in this app, try another paste method in Settings.",
  },
};

function getRuntimeActionableMessage(
  t: TranslateFn,
  payload: RuntimeErrorEvent,
) {
  const normalizedCode = payload.code?.toLowerCase();
  const knownMessage = ACTIONABLE_RUNTIME_MESSAGES[normalizedCode];

  if (knownMessage) {
    return t(knownMessage.key, {
      defaultValue: knownMessage.defaultValue,
      detail: payload.message ?? "",
      reason: payload.message ?? "",
    });
  }

  return t("errors.actionable.generic", {
    defaultValue: getUserFacingErrorMessage(payload.message, {
      t,
      context: "transcription",
      fallback: "Un probleme de transcription est survenu. Reessayez.",
    }),
    detail: getUserFacingErrorMessage(payload.message, {
      t,
      context: "transcription",
      fallback: "Un probleme de transcription est survenu. Reessayez.",
    }),
  });
}

function getLimitedRuntimeHint(
  t: TranslateFn,
  payload: RuntimeErrorEvent,
  hintStateByCode: Record<string, RuntimeHintState>,
  now: number,
) {
  const normalizedCode = payload.code?.toLowerCase();
  const hint = LIMITED_RUNTIME_HINTS[normalizedCode];
  if (!hint) {
    return null;
  }

  const previous = hintStateByCode[normalizedCode];
  const state =
    previous && now - previous.windowStartedAt <= RUNTIME_HINT_WINDOW_MS
      ? previous
      : { count: 0, windowStartedAt: now, lastHintAt: 0 };

  state.count += 1;
  hintStateByCode[normalizedCode] = state;

  if (
    state.count < RUNTIME_HINT_THRESHOLD ||
    now - state.lastHintAt < RUNTIME_HINT_COOLDOWN_MS
  ) {
    return null;
  }

  state.lastHintAt = now;
  return t(hint.key, { defaultValue: hint.defaultValue });
}

export function useBackendEvents({
  t,
  currentSection: _currentSection,
  setCurrentSection,
  settings,
  updateSetting,
}: UseBackendEventsProps) {
  const lastRuntimeErrorRef = useRef<{ key: string; at: number } | null>(null);
  const runtimeHintStateRef = useRef<Record<string, RuntimeHintState>>({});
  const commandModeCountdownRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const clearCommandModeCountdown = useCallback(() => {
    if (commandModeCountdownRef.current !== null) {
      clearInterval(commandModeCountdownRef.current);
      commandModeCountdownRef.current = null;
    }
  }, []);

  // Ctrl+Shift+D / Cmd+Shift+D → toggle debug mode
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  // Backend navigation events (e.g., "Show History" shortcut)
  useTauriEvent<string>(
    "navigate-to-section",
    (event) => {
      const section = event.payload as SidebarSection;
      if (isSectionVisibleInLaunch(section, settings)) {
        setCurrentSection(section);
      }
    },
    [settings, setCurrentSection],
  );

  // Whisper GPU unavailable warning
  useTauriEvent<string>(
    "whisper-gpu-unavailable",
    () => {
      toast.warning(t("warnings.whisperGpuUnavailable"), {
        duration: 8000,
        description: t("warnings.whisperGpuUnavailableDesc"),
      });
    },
    [t],
  );

  // Paste failed error
  useTauriEvent<{ reason?: string; copied_to_clipboard?: boolean }>(
    "paste-failed",
    (event) => {
      const copiedToClipboard = event.payload?.copied_to_clipboard ?? false;
      toast.error(
        copiedToClipboard
          ? t("warnings.pasteFailedCopied")
          : t("warnings.pasteFailed"),
        {
          duration: 8000,
          description: t("warnings.pasteFailedDesc", {
            reason: getUserFacingErrorMessage(event.payload?.reason, {
              t,
              context: "transcription",
              fallback: t("errors.actionable.unknownPasteReason"),
            }),
          }),
        },
      );
    },
    [t],
  );

  // Runtime error toast (with dedup within 1.5s)
  useTauriEvent<RuntimeErrorEvent>(
    "runtime-error",
    (event) => {
      const payload = event.payload;
      if (!payload) return;

      const dedupeKey = `${payload.code}:${payload.message}`;
      const now = Date.now();
      const last = lastRuntimeErrorRef.current;

      if (last && last.key === dedupeKey && now - last.at < 1500) return;

      lastRuntimeErrorRef.current = { key: dedupeKey, at: now };

      const actionableMessage = getRuntimeActionableMessage(t, payload);
      const limitedHint = getLimitedRuntimeHint(
        t,
        payload,
        runtimeHintStateRef.current,
        now,
      );
      const description = limitedHint
        ? `${actionableMessage}\n\n${limitedHint}`
        : actionableMessage;

      if (payload.recoverable) {
        toast.warning(
          t("warnings.runtimeIssue", { defaultValue: "Transcription issue" }),
          { duration: 8000, description },
        );
        return;
      }

      toast.error(
        t("warnings.runtimeFailure", { defaultValue: "Transcription failed" }),
        { duration: 8000, description },
      );
    },
    [t],
  );

  // Transcription lifecycle — show "Text pasted ✓" on completion
  useTauriEvent<{ state?: string }>(
    "transcription-lifecycle",
    (event) => {
      if (event.payload?.state === "completed") {
        toast.success(t("overlay.pasteSuccess"), { duration: 2000 });
      }
    },
    [t],
  );

  // Warmup blocked info toast
  useTauriEvent<string | StartupWarmupStatusSnapshot>(
    "transcription-warmup-blocked",
    (event) => {
      const message =
        typeof event.payload === "string"
          ? event.payload
          : event.payload?.message || t("transcription.warmup_preparing");
      toast(message, {
        duration: 3000,
        description: t("transcription.warmup_ready"),
      });
    },
    [t],
  );

  // command-mode-started → loading toast with live countdown
  useTauriEvent<{ max_duration_secs: number }>(
    "command-mode-started",
    (event) => {
      const maxSecs = event.payload?.max_duration_secs ?? 8;
      let remaining = maxSecs;

      clearCommandModeCountdown();

      toast.loading(
        t("commandMode.recording", {
          count: remaining,
          defaultValue: `Parle maintenant… (${remaining}s)`,
        }),
        { id: "command-mode", duration: Infinity },
      );

      commandModeCountdownRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          toast.loading(
            t("commandMode.recording", {
              count: remaining,
              defaultValue: `Parle maintenant… (${remaining}s)`,
            }),
            { id: "command-mode", duration: Infinity },
          );
        } else {
          clearCommandModeCountdown();
        }
      }, 1000);
    },
    [t, clearCommandModeCountdown],
  );

  // command-mode-processing → swap to spinner
  useTauriEvent(
    "command-mode-processing",
    () => {
      clearCommandModeCountdown();
      toast.loading(
        t("commandMode.processing", { defaultValue: "Traitement en cours…" }),
        { id: "command-mode", duration: Infinity },
      );
    },
    [t, clearCommandModeCountdown],
  );

  // command-mode-finished → dismiss loading toast
  useTauriEvent(
    "command-mode-finished",
    () => {
      clearCommandModeCountdown();
      toast.dismiss("command-mode");
    },
    [clearCommandModeCountdown],
  );

  // command-mode-error → show error toast
  useTauriEvent<{ message: string }>(
    "command-mode-error",
    (event) => {
      clearCommandModeCountdown();
      toast.dismiss("command-mode");
      toast.error(
        t("commandMode.errorTitle", { defaultValue: "Command Mode — erreur" }),
        {
          duration: 6000,
          description: getUserFacingErrorMessage(event.payload?.message, {
            t,
            context: "transcription",
          }),
        },
      );
    },
    [t, clearCommandModeCountdown],
  );

  // whisper-mode-changed
  useTauriEvent<boolean>(
    "whisper-mode-changed",
    (event) => {
      const enabled = event.payload;
      if (enabled) {
        toast.success(
          t("whisperMode.enabled", { defaultValue: "Whisper Mode on" }),
          { duration: 2500 },
        );
      } else {
        toast(t("whisperMode.disabled", { defaultValue: "Whisper Mode off" }), {
          duration: 2500,
        });
      }
    },
    [t],
  );

  // language-toggled
  useTauriEvent<string>(
    "language-toggled",
    (event) => {
      const code = event.payload;
      const langName =
        LANGUAGES.find((l) => l.value === code)?.label ??
        t("languageToggle.auto", { defaultValue: "Auto" });
      toast(
        t("languageToggle.switched", {
          lang: langName,
          defaultValue: `Language: ${langName}`,
        }),
        {
          duration: 2000,
        },
      );
      // Sync the settings store so LanguageSelector reflects the change immediately
      void useSettingsStore.getState().refreshSettings();
    },
    [t],
  );

  // whisper-mode-error
  useTauriEvent<string>(
    "whisper-mode-error",
    (event) => {
      toast.error(
        t("whisperMode.errorTitle", { defaultValue: "Whisper Mode — error" }),
        {
          duration: 6000,
          description: getUserFacingErrorMessage(event.payload, {
            t,
            context: "transcription",
          }),
        },
      );
    },
    [t],
  );
}

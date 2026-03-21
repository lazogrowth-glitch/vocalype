import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import type { SidebarSection } from "@/components/Sidebar";
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

export function useBackendEvents({
  t,
  currentSection: _currentSection,
  setCurrentSection,
  settings,
  updateSetting,
}: UseBackendEventsProps) {
  const lastRuntimeErrorRef = useRef<{ key: string; at: number } | null>(null);
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
  useEffect(() => {
    const unlisten = listen<string>("navigate-to-section", (event) => {
      setCurrentSection(event.payload as SidebarSection);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setCurrentSection]);

  // Whisper GPU unavailable warning
  useEffect(() => {
    const unlisten = listen<string>("whisper-gpu-unavailable", () => {
      toast.warning(t("warnings.whisperGpuUnavailable"), {
        duration: 8000,
        description: t("warnings.whisperGpuUnavailableDesc"),
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Paste failed error
  useEffect(() => {
    const unlisten = listen<{
      reason?: string;
      copied_to_clipboard?: boolean;
    }>("paste-failed", (event) => {
      const copiedToClipboard = event.payload?.copied_to_clipboard ?? false;
      toast.error(
        copiedToClipboard
          ? t("warnings.pasteFailedCopied")
          : t("warnings.pasteFailed"),
        {
          duration: 8000,
          description: t("warnings.pasteFailedDesc", {
            reason:
              event.payload?.reason ??
              t("errors.actionable.unknownPasteReason"),
          }),
        },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Runtime error toast (with dedup within 1.5s)
  useEffect(() => {
    const unlisten = listen<RuntimeErrorEvent>("runtime-error", (event) => {
      const payload = event.payload;
      if (!payload) return;

      const dedupeKey = `${payload.code}:${payload.message}`;
      const now = Date.now();
      const last = lastRuntimeErrorRef.current;

      if (last && last.key === dedupeKey && now - last.at < 1500) {
        return;
      }

      lastRuntimeErrorRef.current = { key: dedupeKey, at: now };

      const ACTION_MAP: Record<string, string> = {
        no_model_loaded: t("errors.actionable.noModelLoaded"),
        microphone_unavailable: t("errors.actionable.microphoneUnavailable"),
        out_of_memory: t("errors.actionable.outOfMemory"),
        audio_capture_failed: t("errors.actionable.audioCaptureFailed"),
      };
      const actionableMessage =
        ACTION_MAP[payload.code] ??
        t("errors.actionable.generic", { detail: payload.message ?? "" });

      if (payload.recoverable) {
        toast.warning(
          t("warnings.runtimeIssue", { defaultValue: "Transcription issue" }),
          { duration: 8000, description: actionableMessage },
        );
        return;
      }

      toast.error(
        t("warnings.runtimeFailure", { defaultValue: "Transcription failed" }),
        { duration: 8000, description: actionableMessage },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Transcription lifecycle — show "Text pasted ✓" on completion
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    listen<{ state?: string }>("transcription-lifecycle", (event) => {
      if (cancelled) return;
      if (event.payload?.state === "completed") {
        toast.success(t("overlay.pasteSuccess"), { duration: 2000 });
      }
    }).then((fn) => {
      cleanup = fn;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [t]);

  // Warmup blocked info toast
  useEffect(() => {
    const unlisten = listen<string | StartupWarmupStatusSnapshot>(
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
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // command-mode-started → loading toast with live countdown
  useEffect(() => {
    const unlisten = listen<{ max_duration_secs: number }>(
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
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, clearCommandModeCountdown]);

  // command-mode-processing → swap to spinner
  useEffect(() => {
    const unlisten = listen("command-mode-processing", () => {
      clearCommandModeCountdown();
      toast.loading(
        t("commandMode.processing", { defaultValue: "Traitement en cours…" }),
        { id: "command-mode", duration: Infinity },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, clearCommandModeCountdown]);

  // command-mode-finished → dismiss loading toast
  useEffect(() => {
    const unlisten = listen("command-mode-finished", () => {
      clearCommandModeCountdown();
      toast.dismiss("command-mode");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearCommandModeCountdown]);

  // command-mode-error → show error toast
  useEffect(() => {
    const unlisten = listen<{ message: string }>(
      "command-mode-error",
      (event) => {
        clearCommandModeCountdown();
        toast.dismiss("command-mode");
        toast.error(
          t("commandMode.errorTitle", {
            defaultValue: "Command Mode — erreur",
          }),
          { duration: 6000, description: event.payload?.message },
        );
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, clearCommandModeCountdown]);

  // whisper-mode-changed
  useEffect(() => {
    const unlisten = listen<boolean>("whisper-mode-changed", (event) => {
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
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // whisper-mode-error
  useEffect(() => {
    const unlisten = listen<string>("whisper-mode-error", (event) => {
      toast.error(
        t("whisperMode.errorTitle", { defaultValue: "Whisper Mode — error" }),
        {
          duration: 6000,
          description: event.payload,
        },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);
}

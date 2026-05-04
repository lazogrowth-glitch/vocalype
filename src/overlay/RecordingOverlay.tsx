import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import { useStartupWarmupStatus } from "@/hooks/useStartupWarmupStatus";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";
import { useVoiceState } from "@/stores/voiceState";

type OverlayState = "preparing" | "recording" | "transcribing" | "processing";

type LifecycleState =
  | "idle"
  | "preparing_microphone"
  | "recording"
  | "paused"
  | "stopping"
  | "transcribing"
  | "processing"
  | "pasting"
  | "completed"
  | "cancelled"
  | "error";

interface LifecycleStateEventPayload {
  state: LifecycleState;
  operation_id?: number | null;
  binding_id?: string | null;
  detail?: string | null;
  recoverable: boolean;
  timestamp_ms: number;
}

interface ActionInfo {
  key: number;
  name: string;
}

const MicIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? "#c9a84c" : "rgba(255,255,255,0.35)"}
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transition: "stroke 300ms ease" }}
  >
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

const DotsIcon: React.FC = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.5)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const XIcon: React.FC = () => (
  <svg
    width="8"
    height="8"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.55)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" x2="6" y1="6" y2="18" />
    <line x1="6" x2="18" y1="6" y2="18" />
  </svg>
);

const formatTime = (s: number) => {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

const TimerDisplay: React.FC<{ startTime: number }> = ({ startTime }) => {
  const [display, setDisplay] = useState("0:00");
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setDisplay(formatTime(elapsed));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startTime]);

  return <div className="timer-text">{display}</div>;
};

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const warmupStatus = useStartupWarmupStatus();
  const warmupMessage = useVoiceState((snapshot) => snapshot.warmupMessage);
  const warmupDetail = useVoiceState((snapshot) => snapshot.warmupDetail);
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [timerStart, setTimerStart] = useState(0);
  const [selectedAction, setSelectedAction] = useState<ActionInfo | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const direction = getLanguageDirection(i18n.language);

  const preparingTitle =
    warmupStatus?.message ||
    warmupMessage ||
    t("overlay.preparingMicrophone", {
      defaultValue: "Starting microphone...",
    });
  const preparingDetail =
    warmupStatus?.detail ||
    warmupDetail ||
    t("transcription.warmup_ready", {
      defaultValue:
        "Dictation will be available automatically once the engine is ready.",
    });

  const handleCancel = useCallback(() => {
    commands.cancelOperation();
  }, []);

  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];

    const register = (eventName: string, handler: any) => {
      listen(eventName, handler).then((fn) => {
        if (!active) fn();
        else cleanups.push(fn);
      });
    };

    register("show-overlay", async (event: any) => {
      await syncLanguageFromSettings();
      const overlayState = event.payload as OverlayState;
      setState(overlayState);
      setIsVisible(true);
      if (overlayState === "recording" || overlayState === "preparing") {
        setTimerStart(Date.now());
        setSelectedAction(null);
      }
    });

    register("hide-overlay", () => {
      setIsVisible(false);
      setSelectedAction(null);
      setCancelPending(false);
      setMicActive(false);
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = null;
      }
    });

    register("transcription-lifecycle", async (event: any) => {
      await syncLanguageFromSettings();
      const lifecycleState = (event.payload as LifecycleStateEventPayload)
        .state;
      if (
        lifecycleState === "idle" ||
        lifecycleState === "completed" ||
        lifecycleState === "cancelled" ||
        lifecycleState === "error"
      ) {
        setIsVisible(false);
        setSelectedAction(null);
        setCancelPending(false);
        setMicActive(false);
        return;
      }

      setIsVisible(true);
      if (lifecycleState === "preparing_microphone") {
        setState("preparing");
        setTimerStart(Date.now());
        setSelectedAction(null);
        return;
      }

      if (
        lifecycleState === "recording" ||
        lifecycleState === "paused" ||
        lifecycleState === "stopping"
      ) {
        setState("recording");
        if (lifecycleState === "recording") {
          setTimerStart((prev) => (prev === 0 ? Date.now() : prev));
        }
        return;
      }

      if (lifecycleState === "transcribing") {
        setState("transcribing");
        return;
      }

      setState("processing");
    });

    register("cancel-pending", () => {
      setCancelPending(true);
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = setTimeout(() => {
        setCancelPending(false);
        cancelTimerRef.current = null;
      }, 1700);
    });

    register("action-selected", (event: any) => {
      setSelectedAction(event.payload as ActionInfo);
    });

    register("action-deselected", () => {
      setSelectedAction(null);
    });

    register("mic-level", (event: any) => {
      const levels = event.payload as number[];
      const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
      if (avg > 0.02) {
        setMicActive(true);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => setMicActive(false), 1500);
      }
    });

    return () => {
      active = false;
      cleanups.forEach((fn) => fn());
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  return (
    <div
      dir={direction}
      role="status"
      className={`recording-overlay state-${state} ${isVisible ? "is-visible" : "is-hidden"}`}
    >
      <span className="sr-only" aria-live="assertive" aria-atomic="true">
        {state === "recording"
          ? t("overlay.a11y.recording")
          : state === "transcribing" || state === "processing"
            ? t("overlay.a11y.transcribing")
            : ""}
      </span>

      <div className="overlay-left">
        {state === "recording" || state === "preparing" ? (
          <MicIcon active={micActive} />
        ) : (
          <DotsIcon />
        )}
      </div>

      {selectedAction && state === "recording" && (
        <div className="action-badge">{selectedAction.key}</div>
      )}

      <div className="overlay-middle">
        {state === "preparing" && (
          <div className="status-stack">
            <div className="transcribing-text">{preparingTitle}</div>
            <div className="overlay-subtext">{preparingDetail}</div>
          </div>
        )}
        {state === "recording" && !cancelPending && (
          <TimerDisplay startTime={timerStart} />
        )}
        {state === "recording" && cancelPending && (
          <div className="cancel-confirm-text">
            {t("overlay.cancelConfirm")}
          </div>
        )}
        {state === "transcribing" && (
          <div className="transcribing-text">{t("overlay.transcribing")}</div>
        )}
        {state === "processing" && (
          <div className="transcribing-text">{t("overlay.processing")}</div>
        )}
      </div>

      <div className="overlay-right">
        {state === "recording" && (
          <button
            type="button"
            className="cancel-button"
            onClick={handleCancel}
            aria-label={t("overlay.cancelRecording", {
              defaultValue: "Cancel recording",
            })}
          >
            <XIcon />
          </button>
        )}
      </div>
    </div>
  );
};

export default RecordingOverlay;

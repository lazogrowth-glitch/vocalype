import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

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

const MicIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.8)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

const DotsIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.7)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const XIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.5)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" x2="6" y1="6" y2="18" />
    <line x1="6" x2="18" y1="6" y2="18" />
  </svg>
);

const PauseIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="rgba(255,255,255,0.6)"
    stroke="none"
  >
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="rgba(255,255,255,0.6)"
    stroke="none"
  >
    <polygon points="6,4 20,12 6,20" />
  </svg>
);

const formatTime = (s: number) => {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

const TimerDisplay: React.FC<{ startTime: number; isPaused: boolean }> = ({
  startTime,
  isPaused,
}) => {
  const [display, setDisplay] = useState("0:00");
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (isPaused) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setDisplay(formatTime(elapsed));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startTime, isPaused]);

  return <div className="timer-text">{display}</div>;
};

const AudioBars: React.FC = () => {
  const barsRef = useRef<HTMLDivElement>(null);
  const smoothedRef = useRef<number[]>(Array(16).fill(0));

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload;
        const smoothed = smoothedRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.65 + target * 0.35;
        });
        smoothedRef.current = smoothed;

        if (barsRef.current) {
          const bars = barsRef.current.children;
          for (let i = 0; i < bars.length; i++) {
            const v = smoothed[i] || 0;
            const el = bars[i] as HTMLElement;
            el.style.height = `${Math.min(20, 3 + Math.pow(v, 0.6) * 17)}px`;
            el.style.opacity = `${Math.max(0.25, v * 1.4)}`;
          }
        }
      });
    };
    setup();
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="bars-container" ref={barsRef}>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="bar" />
      ))}
    </div>
  );
};

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [timerStart, setTimerStart] = useState(0);
  const [selectedAction, setSelectedAction] = useState<ActionInfo | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseStartRef = useRef<number>(0);
  const direction = getLanguageDirection(i18n.language);

  const handleCancel = useCallback(() => {
    commands.cancelOperation();
  }, []);

  const handleTogglePause = useCallback(() => {
    commands.togglePause();
  }, []);

  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];

    const register = (eventName: string, handler: any) => {
      listen(eventName, handler).then((fn) => {
        if (!active) { fn(); } else { cleanups.push(fn); }
      });
    };

    register("show-overlay", async (event: any) => {
      await syncLanguageFromSettings();
      const overlayState = event.payload as OverlayState;
      setState(overlayState);
      setIsVisible(true);
      setIsPaused(false);
      if (overlayState === "recording" || overlayState === "preparing") {
        setTimerStart(Date.now());
        setSelectedAction(null);
      }
    });

    register("hide-overlay", () => {
      setIsVisible(false);
      setSelectedAction(null);
      setCancelPending(false);
      setIsPaused(false);
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = null;
      }
    });

    register("transcription-lifecycle", async (event: any) => {
      await syncLanguageFromSettings();
      const lifecycleState = (event.payload as LifecycleStateEventPayload).state;
      if (
        lifecycleState === "idle" ||
        lifecycleState === "completed" ||
        lifecycleState === "cancelled" ||
        lifecycleState === "error"
      ) {
        setIsVisible(false);
        setSelectedAction(null);
        setCancelPending(false);
        setIsPaused(false);
        return;
      }

      setIsVisible(true);
      if (lifecycleState === "preparing_microphone") {
        setState("preparing");
        setTimerStart(Date.now());
        setSelectedAction(null);
        setIsPaused(false);
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
        setIsPaused(lifecycleState === "paused");
        return;
      }

      if (lifecycleState === "transcribing") {
        setState("transcribing");
        setIsPaused(false);
        return;
      }

      setState("processing");
      setIsPaused(false);
    });

    register("cancel-pending", () => {
      setCancelPending(true);
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
      }
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

    register("recording-paused", (event: any) => {
      const paused = event.payload as boolean;
      setIsPaused(paused);
      if (paused) {
        pauseStartRef.current = Date.now();
      } else {
        const pauseDuration = Date.now() - pauseStartRef.current;
        setTimerStart((prev) => prev + pauseDuration);
      }
    });


    return () => {
      active = false;
      cleanups.forEach((fn) => fn());
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      dir={direction}
      className={`recording-overlay state-${state} ${isVisible ? "is-visible" : "is-hidden"}`}
    >
      <div className="overlay-left">
        {state === "recording" || state === "preparing" ? <MicIcon /> : <DotsIcon />}
      </div>

      {selectedAction && state === "recording" && (
        <div className="action-badge">{selectedAction.key}</div>
      )}

      <div className="overlay-middle">
        {state === "preparing" && (
          <div className="transcribing-text">
            {t("overlay.preparingMicrophone", {
              defaultValue: "Starting microphone...",
            })}
          </div>
        )}
        {state === "recording" && !cancelPending && (
          <>
            <TimerDisplay startTime={timerStart} isPaused={isPaused} />
            <AudioBars />
          </>
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
          <>
            <button
              type="button"
              className="pause-button"
              onClick={handleTogglePause}
              aria-label={
                isPaused
                  ? t("overlay.resumeRecording", {
                      defaultValue: "Resume recording",
                    })
                  : t("overlay.pauseRecording", {
                      defaultValue: "Pause recording",
                    })
              }
            >
              {isPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
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
          </>
        )}
      </div>
    </div>
  );
};

export default RecordingOverlay;

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";
import type {
  MachineStatusMode,
  RuntimeDiagnosticsSnapshot,
} from "@/types/runtimeObservability";

const MODEL_LABELS: Record<string, string> = {
  "parakeet-tdt-0.6b-v3-multilingual": "Parakeet V3 Multilingual",
  "parakeet-tdt-0.6b-v3-english": "Parakeet V3 English",
  turbo: "Whisper Turbo",
  large: "Whisper Large",
  medium: "Whisper Medium",
  small: "Whisper Small",
};

const MODE_STYLES: Record<MachineStatusMode, string> = {
  optimal: "border-emerald-400/25 bg-[rgba(20,80,40,0.4)] text-white/60",
  battery: "border-amber-400/12 bg-amber-400/[0.06] text-amber-100",
  saver: "border-amber-400/12 bg-amber-400/[0.06] text-amber-100",
  thermal: "border-rose-400/12 bg-rose-400/[0.06] text-rose-100",
  memory_limited: "border-orange-400/12 bg-orange-400/[0.06] text-orange-100",
  fallback: "border-sky-400/12 bg-sky-400/[0.06] text-sky-100",
  calibrating: "border-violet-400/12 bg-violet-400/[0.06] text-violet-100",
};

async function fetchDiagnostics(): Promise<RuntimeDiagnosticsSnapshot | null> {
  const result = await commands.getRuntimeDiagnostics();
  if (result.status === "ok") {
    return result.data as RuntimeDiagnosticsSnapshot;
  }
  return null;
}

export const MachineStatusBar: React.FC<{ variant?: "banner" | "sidebar" }> = ({
  variant = "banner",
}) => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const next = await fetchDiagnostics();
      if (active) {
        setSnapshot(next);
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);

    let cleanupAdaptive: (() => void) | undefined;
    let cleanupLifecycle: (() => void) | undefined;

    listen("adaptive-profile-updated", () => {
      void refresh();
    }).then((fn) => {
      if (!active) {
        fn();
      } else {
        cleanupAdaptive = fn;
      }
    });
    listen("transcription-lifecycle", () => {
      void refresh();
    }).then((fn) => {
      if (!active) {
        fn();
      } else {
        cleanupLifecycle = fn;
      }
    });

    return () => {
      active = false;
      window.clearInterval(interval);
      cleanupAdaptive?.();
      cleanupLifecycle?.();
    };
  }, []);

  const status = snapshot?.machine_status;
  if (!status) {
    return null;
  }

  const modelLabel = status.active_model_id
    ? (MODEL_LABELS[status.active_model_id] ?? status.active_model_id)
    : null;
  const backendLabel = status.active_backend
    ? status.active_backend.toUpperCase()
    : null;

  if (variant === "sidebar") {
    return (
      <div
        className={`rounded-full border px-[10px] py-[6px] ${MODE_STYLES[status.mode]}`}
      >
        <div className="flex items-center gap-2">
          <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-emerald-400" />
          <span className="sr-only" aria-live="polite">
            {status.mode === "optimal"
              ? t("a11y.statusReady")
              : status.mode === "thermal" || status.mode === "fallback"
                ? t("a11y.statusError")
                : t("a11y.statusReady")}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium leading-[1.3] text-emerald-400">
              {modelLabel ?? status.headline}
            </div>
            <div className="truncate text-[11px] leading-[1.3] text-white/55">
              {backendLabel ? `${backendLabel} · ` : ""}
              {status.headline}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-6 pt-4">
      <div
        className={`rounded-xl border px-4 py-3 text-[13px] shadow-[0_8px_18px_rgba(0,0,0,0.12)] ${MODE_STYLES[status.mode]}`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full border border-current/10 bg-black/10 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.18em]">
            {status.mode.replace(/_/g, " ")}
          </span>
          <span className="font-medium text-text">{status.headline}</span>
          {(modelLabel || backendLabel) && (
            <span className="min-w-0 break-words text-current/68">
              {modelLabel}
              {backendLabel ? ` · ${backendLabel}` : ""}
            </span>
          )}
        </div>
        {status.detail && status.mode !== "optimal" && (
          <p className="mt-2 text-[12px] leading-5 text-current/68">
            {status.detail}
          </p>
        )}
      </div>
    </div>
  );
};

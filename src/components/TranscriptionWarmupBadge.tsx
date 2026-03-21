import React from "react";
import { LoaderCircle, Mic, TriangleAlert } from "lucide-react";
import { useStartupWarmupStatus } from "@/hooks/useStartupWarmupStatus";
import { getStartupWarmupFallbackDetail } from "@/types/startupWarmup";

export const TranscriptionWarmupBadge: React.FC = () => {
  const status = useStartupWarmupStatus();

  if (!status || status.phase === "idle") {
    return null;
  }

  const isPreparing = status.phase === "preparing";
  const isReady = status.phase === "ready";
  const isFailed = status.phase === "failed";

  return (
    <div
      className={`mx-[18px] mt-3 rounded-[10px] border px-3 py-2 ${
        isReady
          ? "border-emerald-400/20 bg-emerald-400/10"
          : isFailed
            ? "border-red-400/20 bg-red-400/10"
            : "border-white/10 bg-white/[0.04]"
      }`}
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            isReady
              ? "bg-emerald-400/15 text-emerald-300"
              : isFailed
                ? "bg-red-400/15 text-red-300"
                : "bg-logo-primary/15 text-logo-primary"
          }`}
        >
          {isPreparing && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {isReady && <Mic className="h-4 w-4" />}
          {isFailed && <TriangleAlert className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-white/85">
            {status.message}
          </p>
          <p className="truncate text-[10.5px] text-white/45">
            {status.detail || getStartupWarmupFallbackDetail(status)}
          </p>
        </div>
      </div>
    </div>
  );
};

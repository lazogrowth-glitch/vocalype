import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";
import type { StartupWarmupStatusSnapshot } from "@/types/startupWarmup";
import { cleanupTauriListen } from "@/lib/tauri/events";

export function useStartupWarmupStatus() {
  const [status, setStatus] = useState<StartupWarmupStatusSnapshot | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const result = await commands.getStartupWarmupStatus();
        if (active && result.status === "ok") {
          setStatus(result.data as StartupWarmupStatusSnapshot);
        }
      } catch {
        if (active) {
          setStatus(null);
        }
      }
    };

    void refresh();
    const unlisten = listen<StartupWarmupStatusSnapshot>(
      "startup-warmup-changed",
      (event) => {
        if (active) {
          setStatus(event.payload);
        }
      },
    );

    return () => {
      active = false;
      cleanupTauriListen(unlisten);
    };
  }, []);

  return status;
}

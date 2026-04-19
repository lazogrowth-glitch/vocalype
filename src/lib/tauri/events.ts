import type { UnlistenFn } from "@tauri-apps/api/event";

type MaybeAsyncUnlisten = UnlistenFn | (() => Promise<void>);

function isCatchablePromise(value: unknown): value is Promise<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "catch" in value &&
    typeof value.catch === "function"
  );
}

export function safeUnlisten(unlisten: MaybeAsyncUnlisten | undefined) {
  if (typeof unlisten !== "function") {
    return;
  }

  try {
    const maybePromise: unknown = unlisten();
    if (isCatchablePromise(maybePromise)) {
      void maybePromise.catch(() => {
        /* Tauri listener cleanup races are safe to ignore. */
      });
    }
  } catch {
    /* Tauri listener cleanup races are safe to ignore. */
  }
}

export function cleanupTauriListen(
  unlistenPromise: Promise<MaybeAsyncUnlisten>,
) {
  void unlistenPromise.then(safeUnlisten).catch(() => {
    /* Listener registration may fail during startup/HMR teardown. */
  });
}

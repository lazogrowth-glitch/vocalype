import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type {
  RuntimeErrorEvent,
  TranscriptionLifecycleState,
} from "@/types/runtimeObservability";
import type { StartupWarmupStatusSnapshot } from "@/types/startupWarmup";

export type VoiceUiState =
  | "idle"
  | "warming_up"
  | "recording"
  | "processing"
  | "error";

export interface VoiceStateSnapshot {
  uiState: VoiceUiState;
  lifecycleState: TranscriptionLifecycleState | "idle";
  isPaused: boolean;
  audioLevels: number[];
  lastError: RuntimeErrorEvent | null;
  operationId: number | null;
  interimText: string | null;
  warmupMessage: string | null;
  warmupDetail: string | null;
  updatedAt: number;
}

type Listener = () => void;

const DEFAULT_LEVELS = Array.from({ length: 9 }, () => 0);

let snapshot: VoiceStateSnapshot = {
  uiState: "idle",
  lifecycleState: "idle",
  isPaused: false,
  audioLevels: DEFAULT_LEVELS,
  lastError: null,
  operationId: null,
  interimText: null,
  warmupMessage: null,
  warmupDetail: null,
  updatedAt: Date.now(),
};

const listeners = new Set<Listener>();
let initialized = false;
let unlistenFns: UnlistenFn[] = [];

function emit() {
  snapshot = {
    ...snapshot,
    updatedAt: Date.now(),
  };
  listeners.forEach((listener) => listener());
}

function mapLifecycleToUiState(
  lifecycleState: TranscriptionLifecycleState | "idle",
): VoiceUiState {
  switch (lifecycleState) {
    case "preparing_microphone":
      return "warming_up";
    case "recording":
    case "paused":
    case "stopping":
      return "recording";
    case "transcribing":
    case "processing":
    case "pasting":
      return "processing";
    case "error":
      return "error";
    case "idle":
    case "completed":
    case "cancelled":
    default:
      return "idle";
  }
}

async function initVoiceStateStore() {
  if (initialized) {
    return;
  }
  initialized = true;

  const lifecycleUnlisten = await listen<{
    state?: TranscriptionLifecycleState;
    operation_id?: number | null;
  }>("transcription-lifecycle", (event) => {
    const lifecycleState = event.payload.state ?? "idle";
    const nextOperationId = event.payload.operation_id ?? null;
    const shouldResetInterim =
      lifecycleState === "preparing_microphone" ||
      (nextOperationId !== null && nextOperationId !== snapshot.operationId);
    snapshot = {
      ...snapshot,
      lifecycleState,
      uiState: mapLifecycleToUiState(lifecycleState),
      operationId: nextOperationId,
      isPaused: lifecycleState === "paused" ? true : snapshot.isPaused,
      audioLevels:
        lifecycleState === "idle" ||
        lifecycleState === "completed" ||
        lifecycleState === "cancelled" ||
        lifecycleState === "error"
          ? DEFAULT_LEVELS
          : snapshot.audioLevels,
      interimText:
        lifecycleState === "idle" ||
        lifecycleState === "completed" ||
        lifecycleState === "cancelled" ||
        lifecycleState === "error" ||
        shouldResetInterim
          ? null
          : snapshot.interimText,
    };
    emit();
  });

  const pausedUnlisten = await listen<boolean>("recording-paused", (event) => {
    snapshot = {
      ...snapshot,
      isPaused: event.payload,
    };
    emit();
  });

  const levelUnlisten = await listen<number[]>("mic-level", (event) => {
    snapshot = {
      ...snapshot,
      audioLevels: event.payload,
    };
    emit();
  });

  const previewUnlisten = await listen<{
    operation_id?: number | null;
    text?: string | null;
    stage?: string | null;
    stable?: boolean;
  }>("transcription-preview", (event) => {
    const nextText = event.payload?.text?.trim() || null;
    snapshot = {
      ...snapshot,
      operationId: event.payload?.operation_id ?? snapshot.operationId,
      interimText: nextText,
    };
    emit();
  });

  const warmupUnlisten = await listen<StartupWarmupStatusSnapshot>(
    "startup-warmup-changed",
    (event) => {
      snapshot = {
        ...snapshot,
        warmupMessage: event.payload?.message ?? null,
        warmupDetail: event.payload?.detail ?? null,
        uiState:
          event.payload?.phase === "preparing" &&
          snapshot.lifecycleState === "idle"
            ? "warming_up"
            : snapshot.uiState,
      };
      emit();
    },
  );

  const errorUnlisten = await listen<RuntimeErrorEvent>("runtime-error", (event) => {
    snapshot = {
      ...snapshot,
      lastError: event.payload,
      uiState:
        snapshot.lifecycleState === "idle"
          ? "error"
          : snapshot.uiState,
    };
    emit();
  });

  unlistenFns = [
    lifecycleUnlisten,
    pausedUnlisten,
    levelUnlisten,
    previewUnlisten,
    warmupUnlisten,
    errorUnlisten,
  ];
}

export function ensureVoiceStateStore() {
  void initVoiceStateStore();
}

export function getVoiceStateSnapshot(): VoiceStateSnapshot {
  return snapshot;
}

export function subscribeVoiceState(listener: Listener): () => void {
  ensureVoiceStateStore();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVoiceState<T>(
  selector: (snapshot: VoiceStateSnapshot) => T,
): T {
  ensureVoiceStateStore();
  return useSyncExternalStore(
    subscribeVoiceState,
    () => selector(getVoiceStateSnapshot()),
    () => selector(getVoiceStateSnapshot()),
  );
}

export function disposeVoiceStateStoreForTests() {
  unlistenFns.forEach((unlisten) => unlisten());
  unlistenFns = [];
  initialized = false;
  snapshot = {
    uiState: "idle",
    lifecycleState: "idle",
    isPaused: false,
    audioLevels: DEFAULT_LEVELS,
    lastError: null,
    operationId: null,
    interimText: null,
    warmupMessage: null,
    warmupDetail: null,
    updatedAt: Date.now(),
  };
  listeners.clear();
}

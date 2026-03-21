export type StartupWarmupPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "failed";

export type StartupWarmupReason =
  | "no_model_selected"
  | "model_not_downloaded"
  | "preparing_microphone"
  | "preparing_model"
  | "ready"
  | "microphone_error"
  | "model_error";

export interface StartupWarmupStatusSnapshot {
  phase: StartupWarmupPhase;
  reason: StartupWarmupReason;
  can_record: boolean;
  microphone_ready: boolean;
  model_ready: boolean;
  message: string;
  detail?: string | null;
  updated_at_ms: number;
}

export function getStartupWarmupFallbackDetail(
  status: StartupWarmupStatusSnapshot,
): string {
  switch (status.reason) {
    case "no_model_selected":
      return "Choisissez un modele de dictee pour activer le raccourci.";
    case "model_not_downloaded":
      return "Telechargez le modele selectionne pour activer la dictee.";
    case "preparing_microphone":
      return "Le raccourci de dictee s'activera automatiquement.";
    case "preparing_model":
      return "Le moteur vocal termine son chargement en arriere-plan.";
    case "ready":
      return "Vous pouvez commencer a dicter.";
    case "microphone_error":
      return "Verifiez votre microphone pour reactiver la dictee.";
    case "model_error":
      return "Verifiez le modele vocal pour reactiver la dictee.";
    default:
      return "La dictee sera disponible automatiquement des qu'elle sera prete.";
  }
}

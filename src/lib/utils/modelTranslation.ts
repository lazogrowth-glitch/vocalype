import type { TFunction } from "i18next";
import type { ModelInfo } from "@/bindings";

const isVocalypeNativeModel = (model: ModelInfo): boolean =>
  model.id === "parakeet-tdt-0.6b-v3-multilingual";

/**
 * Get the translated name for a model
 * @param model - The model info object
 * @param t - The translation function from useTranslation
 * @returns The translated model name, or the original name if no translation exists
 */
export function getTranslatedModelName(model: ModelInfo, t: TFunction): string {
  if (isVocalypeNativeModel(model)) {
    return t("settings.models.primary.vocalypeNativeName", {
      defaultValue: "Vocalype Native",
    });
  }

  const translationKey = `onboarding.models.${model.id}.name`;
  const translated = t(translationKey, { defaultValue: "" });
  return translated !== "" ? translated : model.name;
}

/**
 * Get the translated description for a model
 * @param model - The model info object
 * @param t - The translation function from useTranslation
 * @returns The translated model description, or the original description if no translation exists
 */
export function getTranslatedModelDescription(
  model: ModelInfo,
  t: TFunction,
): string {
  if (isVocalypeNativeModel(model)) {
    return t("settings.models.primary.vocalypeNativeDescription", {
      defaultValue:
        "Fast on-device transcription tuned for Vocalype. Best default for private, low-latency dictation.",
    });
  }

  // Custom models use a generic translation key
  if (model.is_custom) {
    return t("onboarding.customModelDescription");
  }

  const translationKey = `onboarding.models.${model.id}.description`;
  const translated = t(translationKey, { defaultValue: "" });
  return translated !== "" ? translated : model.description;
}

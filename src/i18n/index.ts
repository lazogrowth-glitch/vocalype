import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { locale } from "@tauri-apps/plugin-os";
import { LANGUAGE_METADATA } from "./languages";
import { commands } from "@/bindings";
import { hasTauriRuntime } from "@/lib/tauri/runtime";
import {
  getLanguageDirection,
  updateDocumentDirection,
  updateDocumentLanguage,
} from "@/lib/utils/rtl";
import enTranslation from "./locales/en/translation.json";

// Keep non-English translations out of the initial bundle and load them on demand.
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*/translation.json",
);

const AVAILABLE_LANGUAGE_CODES = Object.keys(localeModules)
  .map((path) => path.match(/\.\/locales\/(.+)\/translation\.json/)?.[1])
  .filter((code): code is string => Boolean(code));

// Initialize with English only; other locales are lazy-loaded as needed.
const resources: Record<string, { translation: Record<string, unknown> }> = {
  en: { translation: enTranslation },
};

// Build supported languages list from discovered locales + metadata
// Only include languages that have explicit metadata entries
export const SUPPORTED_LANGUAGES = AVAILABLE_LANGUAGE_CODES.filter(
  (code) => LANGUAGE_METADATA[code] !== undefined,
)
  .map((code) => {
    const meta = LANGUAGE_METADATA[code];
    return {
      code,
      name: meta.name,
      nativeName: meta.nativeName,
      priority: meta.priority,
    };
  })
  .sort((a, b) => {
    // Sort by priority first (lower = higher), then alphabetically
    if (a.priority !== undefined && b.priority !== undefined) {
      return a.priority - b.priority;
    }
    if (a.priority !== undefined) return -1;
    if (b.priority !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });

export type SupportedLanguageCode = string;

const loadedLanguages = new Set<string>(["en"]);

// Check if a language code is supported
const getSupportedLanguage = (
  langCode: string | null | undefined,
): SupportedLanguageCode | null => {
  if (!langCode) return null;
  const normalized = langCode.toLowerCase();
  // Try exact match first
  let supported = SUPPORTED_LANGUAGES.find(
    (lang) => lang.code.toLowerCase() === normalized,
  );
  if (!supported) {
    // Fall back to prefix match (language only, without region)
    const prefix = normalized.split("-")[0];
    supported = SUPPORTED_LANGUAGES.find(
      (lang) => lang.code.toLowerCase() === prefix,
    );
  }
  return supported ? supported.code : null;
};

// Initialize i18n with English as default
// Language will be synced from settings after init
i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Disable suspense for SSR compatibility
  },
});

export const ensureLanguageResources = async (
  langCode: string,
): Promise<SupportedLanguageCode> => {
  const supported = getSupportedLanguage(langCode) ?? "en";

  if (
    loadedLanguages.has(supported) ||
    i18n.hasResourceBundle(supported, "translation")
  ) {
    loadedLanguages.add(supported);
    return supported;
  }

  const loader = localeModules[`./locales/${supported}/translation.json`];
  if (!loader) {
    return "en";
  }

  const module = await loader();
  i18n.addResourceBundle(supported, "translation", module.default, true, true);
  loadedLanguages.add(supported);
  return supported;
};

export const changeAppLanguage = async (langCode: string) => {
  const supported = await ensureLanguageResources(langCode);
  if (supported !== i18n.language) {
    await i18n.changeLanguage(supported);
  }
  return supported;
};

// Sync language from app settings
export const syncLanguageFromSettings = async () => {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const result = await commands.getAppSettings();
    if (result.status === "ok" && result.data.app_language) {
      const supported = getSupportedLanguage(result.data.app_language);
      if (supported) {
        await changeAppLanguage(supported);
      }
    } else {
      // Fall back to system locale detection if no saved preference
      const systemLocale = await locale();
      const supported = getSupportedLanguage(systemLocale);
      if (supported) {
        await changeAppLanguage(supported);
      }
    }
  } catch (e) {
    console.warn("Failed to sync language from settings:", e);
  }
};

// Listen for language changes to update HTML dir and lang attributes
i18n.on("languageChanged", (lng) => {
  const dir = getLanguageDirection(lng);
  updateDocumentDirection(dir);
  updateDocumentLanguage(lng);
});

// Re-export RTL utilities for convenience
export { getLanguageDirection, isRTLLanguage } from "@/lib/utils/rtl";

export default i18n;

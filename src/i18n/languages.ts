/**
 * Language metadata for supported locales.
 *
 * To add a new language:
 * 1. Create a new folder: src/i18n/locales/{code}/translation.json
 * 2. Add an entry here with the language code, English name, and native name
 * 3. Optionally add a priority (lower = higher in dropdown, no priority = alphabetical at end)
 * 4. For RTL languages, add direction: 'rtl'
 */
export const LANGUAGE_METADATA: Record<
  string,
  {
    name: string;
    nativeName: string;
    priority?: number;
    direction?: "ltr" | "rtl";
  }
> = {
  en: { name: "English", nativeName: "English", priority: 1 },
  zh: { name: "Simplified Chinese", nativeName: "????", priority: 2 },
  "zh-TW": { name: "Traditional Chinese", nativeName: "????", priority: 3 },
  es: { name: "Spanish", nativeName: "Espa?ol", priority: 4 },
  fr: { name: "French", nativeName: "Fran?ais", priority: 5 },
  de: { name: "German", nativeName: "Deutsch", priority: 6 },
  ja: { name: "Japanese", nativeName: "???", priority: 7 },
  ko: { name: "Korean", nativeName: "???", priority: 8 },
  vi: { name: "Vietnamese", nativeName: "Ti?ng Vi?t", priority: 9 },
  pl: { name: "Polish", nativeName: "Polski", priority: 10 },
  it: { name: "Italian", nativeName: "Italiano", priority: 11 },
  ru: { name: "Russian", nativeName: "???????", priority: 12 },
  uk: { name: "Ukrainian", nativeName: "??????????", priority: 13 },
  pt: { name: "Portuguese", nativeName: "Portugu?s", priority: 14 },
  cs: { name: "Czech", nativeName: "?e?tina", priority: 15 },
  tr: { name: "Turkish", nativeName: "T?rk?e", priority: 16 },
  ar: { name: "Arabic", nativeName: "???????", priority: 17, direction: "rtl" },
};

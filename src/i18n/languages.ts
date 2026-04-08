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
  zh: {
    name: "Simplified Chinese",
    nativeName: "\u7b80\u4f53\u4e2d\u6587",
    priority: 2,
  },
  "zh-TW": {
    name: "Traditional Chinese",
    nativeName: "\u7e41\u9ad4\u4e2d\u6587",
    priority: 3,
  },
  es: { name: "Spanish", nativeName: "Espa\u00f1ol", priority: 4 },
  fr: { name: "French", nativeName: "Fran\u00e7ais", priority: 5 },
  de: { name: "German", nativeName: "Deutsch", priority: 6 },
  ja: { name: "Japanese", nativeName: "\u65e5\u672c\u8a9e", priority: 7 },
  ko: { name: "Korean", nativeName: "\ud55c\uad6d\uc5b4", priority: 8 },
  vi: { name: "Vietnamese", nativeName: "Ti\u1ebfng Vi\u1ec7t", priority: 9 },
  pl: { name: "Polish", nativeName: "Polski", priority: 10 },
  it: { name: "Italian", nativeName: "Italiano", priority: 11 },
  ru: {
    name: "Russian",
    nativeName: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
    priority: 12,
  },
  uk: {
    name: "Ukrainian",
    nativeName: "\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430",
    priority: 13,
  },
  pt: { name: "Portuguese", nativeName: "Portugu\u00eas", priority: 14 },
  cs: { name: "Czech", nativeName: "\u010ce\u0161tina", priority: 15 },
  tr: { name: "Turkish", nativeName: "T\u00fcrk\u00e7e", priority: 16 },
  ar: {
    name: "Arabic",
    nativeName: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
    priority: 17,
    direction: "rtl",
  },
};

import { describe, it, expect } from "vitest";

vi.mock("@/i18n/languages", () => ({
  LANGUAGE_METADATA: {
    ar: { name: "Arabic", direction: "rtl" },
    he: { name: "Hebrew", direction: "rtl" },
    fa: { name: "Persian", direction: "rtl" },
    en: { name: "English" },
    fr: { name: "French" },
    de: { name: "German" },
    zh: { name: "Chinese" },
  } as Record<string, { name: string; direction?: "ltr" | "rtl" }>,
}));

import {
  isRTLLanguage,
  getLanguageDirection,
  updateDocumentDirection,
  updateDocumentLanguage,
  initializeRTL,
} from "./rtl";

describe("isRTLLanguage", () => {
  it("returns true for Arabic", () => {
    expect(isRTLLanguage("ar")).toBe(true);
  });

  it("returns true for Hebrew", () => {
    expect(isRTLLanguage("he")).toBe(true);
  });

  it("returns false for English", () => {
    expect(isRTLLanguage("en")).toBe(false);
  });

  it("returns false for French", () => {
    expect(isRTLLanguage("fr")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRTLLanguage("")).toBe(false);
  });

  it("strips region subtag (ar-SA → ar)", () => {
    expect(isRTLLanguage("ar-SA")).toBe(true);
  });

  it("returns false for unknown language", () => {
    expect(isRTLLanguage("xx")).toBe(false);
  });
});

describe("getLanguageDirection", () => {
  it("returns 'rtl' for Arabic", () => {
    expect(getLanguageDirection("ar")).toBe("rtl");
  });

  it("returns 'ltr' for English", () => {
    expect(getLanguageDirection("en")).toBe("ltr");
  });

  it("returns 'ltr' for unknown language", () => {
    expect(getLanguageDirection("xx")).toBe("ltr");
  });
});

describe("updateDocumentDirection", () => {
  it("sets dir attribute on documentElement", () => {
    updateDocumentDirection("rtl");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    updateDocumentDirection("ltr");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });
});

describe("updateDocumentLanguage", () => {
  it("sets lang attribute on documentElement", () => {
    updateDocumentLanguage("ar");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });
});

describe("initializeRTL", () => {
  it("sets dir=rtl and lang=ar for Arabic", () => {
    initializeRTL("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("sets dir=ltr and lang=en for English", () => {
    initializeRTL("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});

import { describe, it, expect, vi } from "vitest";
import { getTranslatedModelName, getTranslatedModelDescription } from "./modelTranslation";
import type { ModelInfo } from "@/bindings";

const makeModel = (overrides: Partial<ModelInfo> = {}): ModelInfo =>
  ({
    id: "whisper-small",
    name: "Whisper Small",
    description: "A small whisper model",
    is_custom: false,
    is_downloaded: true,
    is_downloading: false,
    size_mb: 150,
    ...overrides,
  }) as ModelInfo;

describe("getTranslatedModelName", () => {
  it("returns translated name when translation key resolves to a non-empty string", () => {
    const t = vi.fn().mockReturnValue("Petit Whisper");
    expect(getTranslatedModelName(makeModel(), t as never)).toBe("Petit Whisper");
    expect(t).toHaveBeenCalledWith("onboarding.models.whisper-small.name", { defaultValue: "" });
  });

  it("falls back to model.name when translation returns empty string", () => {
    const t = vi.fn().mockReturnValue("");
    expect(getTranslatedModelName(makeModel(), t as never)).toBe("Whisper Small");
  });

  it("uses model.id in the translation key", () => {
    const t = vi.fn().mockReturnValue("");
    getTranslatedModelName(makeModel({ id: "parakeet-v3" }), t as never);
    expect(t).toHaveBeenCalledWith("onboarding.models.parakeet-v3.name", { defaultValue: "" });
  });
});

describe("getTranslatedModelDescription", () => {
  it("returns translated description when translation key resolves", () => {
    const t = vi.fn().mockReturnValue("Un modèle rapide");
    expect(getTranslatedModelDescription(makeModel(), t as never)).toBe("Un modèle rapide");
    expect(t).toHaveBeenCalledWith("onboarding.models.whisper-small.description", {
      defaultValue: "",
    });
  });

  it("falls back to model.description when translation is empty", () => {
    const t = vi.fn().mockReturnValue("");
    expect(getTranslatedModelDescription(makeModel(), t as never)).toBe("A small whisper model");
  });

  it("uses customModelDescription key for custom models", () => {
    const t = vi.fn().mockReturnValue("Not officially supported");
    const result = getTranslatedModelDescription(makeModel({ is_custom: true }), t as never);
    expect(result).toBe("Not officially supported");
    expect(t).toHaveBeenCalledWith("onboarding.customModelDescription");
  });

  it("does not call the per-model description key for custom models", () => {
    const t = vi.fn().mockReturnValue("x");
    getTranslatedModelDescription(makeModel({ is_custom: true }), t as never);
    const keys = (t as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(keys).not.toContain("onboarding.models.whisper-small.description");
  });

  it("uses model.id in the description translation key", () => {
    const t = vi.fn().mockReturnValue("");
    getTranslatedModelDescription(makeModel({ id: "parakeet-tdt-0.6b-v3" }), t as never);
    expect(t).toHaveBeenCalledWith(
      "onboarding.models.parakeet-tdt-0.6b-v3.description",
      { defaultValue: "" },
    );
  });
});

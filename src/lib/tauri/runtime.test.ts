import { describe, it, expect, vi, afterEach } from "vitest";
import { hasTauriRuntime, waitForTauriRuntime } from "./runtime";

describe("tauri runtime helpers", () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("returns false when runtime internals are missing", () => {
    expect(hasTauriRuntime()).toBe(false);
  });

  it("returns true when invoke and transformCallback exist", () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
      transformCallback: vi.fn(),
    };

    expect(hasTauriRuntime()).toBe(true);
  });

  it("times out cleanly when runtime never arrives", async () => {
    const result = await waitForTauriRuntime(20);
    expect(result).toBe(false);
  });
});

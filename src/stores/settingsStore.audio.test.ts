import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { commands } from "@/bindings";

vi.mock("@/bindings", () => ({
  commands: {
    getAvailableMicrophones: vi.fn(),
    getAvailableOutputDevices: vi.fn(),
  },
}));

describe("settingsStore audio device loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      audioDevices: [],
      outputDevices: [],
    });
  });

  it("falls back to the default microphone when backend returns an error result", async () => {
    vi.mocked(commands.getAvailableMicrophones).mockResolvedValue({
      status: "error",
      error: "permission denied",
    } as never);

    await useSettingsStore.getState().refreshAudioDevices();

    expect(useSettingsStore.getState().audioDevices).toEqual([
      { index: "default", name: "Default", is_default: true },
    ]);
  });

  it("falls back to the default microphone when the command throws", async () => {
    vi.mocked(commands.getAvailableMicrophones).mockRejectedValue(
      new Error("microphone disconnected"),
    );

    await useSettingsStore.getState().refreshAudioDevices();

    expect(useSettingsStore.getState().audioDevices).toEqual([
      { index: "default", name: "Default", is_default: true },
    ]);
  });
});

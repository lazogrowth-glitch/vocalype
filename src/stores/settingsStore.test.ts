import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettingsStore } from "./settingsStore";
import type { AppSettings } from "@/bindings";
import { commands } from "@/bindings";

const mockSettings = {
  push_to_talk: false,
  selected_model: "base",
  audio_feedback: true,
  audio_feedback_volume: 0.8,
  always_on_microphone: false,
  selected_microphone: "Default",
  clamshell_microphone: "Default",
  selected_output_device: "Default",
  recording_retention_period: "forever",
  translate_to_english: false,
  selected_language: "auto",
  overlay_position: "bottom-center",
  debug_mode: false,
  custom_words: [],
  adaptive_vocabulary_enabled: true,
  adaptive_voice_profile_enabled: true,
  word_correction_threshold: 0.8,
  paste_method: "clipboard",
  typing_tool: "default",
  external_script_path: null,
  clipboard_handling: "restore",
  auto_submit: false,
  auto_submit_key: "Enter",
  post_process_enabled: false,
  post_process_selected_prompt_id: "",
  mute_while_recording: false,
  append_trailing_space: true,
  log_level: "info",
  app_language: "en",
  experimental_enabled: false,
  show_tray_icon: true,
  sound_theme: "marimba" as const,
  start_hidden: false,
  autostart_enabled: false,
  update_checks_enabled: true,
  bindings: {},
  post_process_provider_id: "openai",
  post_process_api_keys: {},
  post_process_base_urls: {},
  post_process_models: {},
  post_process_prompts: [],
} as unknown as AppSettings;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    settings: null,
    isLoading: true,
    isUpdating: {},
    audioDevices: [],
    outputDevices: [],
    customSounds: { start: false, stop: false },
    postProcessModelOptions: {},
    defaultSettings: null,
  });
});

describe("settingsStore.updateSetting", () => {
  it("optimistically updates the setting", async () => {
    vi.mocked(commands.changeAudioFeedbackSetting).mockResolvedValue(
      undefined as never,
    );
    useSettingsStore.setState({ settings: { ...mockSettings } });

    await useSettingsStore.getState().updateSetting("audio_feedback", false);

    expect(useSettingsStore.getState().settings?.audio_feedback).toBe(false);
    expect(commands.changeAudioFeedbackSetting).toHaveBeenCalledWith(false);
  });

  it("rolls back on command failure", async () => {
    vi.mocked(commands.changeAudioFeedbackSetting).mockRejectedValue(
      new Error("Rust command failed"),
    );
    useSettingsStore.setState({
      settings: { ...mockSettings, audio_feedback: true },
    });

    await useSettingsStore.getState().updateSetting("audio_feedback", false);

    // Should roll back to original value
    expect(useSettingsStore.getState().settings?.audio_feedback).toBe(true);
  });

  it("clears isUpdating flag after success", async () => {
    vi.mocked(commands.changeAudioFeedbackSetting).mockResolvedValue(
      undefined as never,
    );
    useSettingsStore.setState({ settings: { ...mockSettings } });

    await useSettingsStore.getState().updateSetting("audio_feedback", false);

    expect(
      useSettingsStore.getState().isUpdating["audio_feedback"],
    ).toBeFalsy();
  });

  it("clears isUpdating flag after failure", async () => {
    vi.mocked(commands.changeAudioFeedbackSetting).mockRejectedValue(
      new Error("fail"),
    );
    useSettingsStore.setState({ settings: { ...mockSettings } });

    await useSettingsStore.getState().updateSetting("audio_feedback", false);

    expect(
      useSettingsStore.getState().isUpdating["audio_feedback"],
    ).toBeFalsy();
  });
});

describe("settingsStore.refreshSettings", () => {
  it("sets settings on successful load", async () => {
    vi.mocked(commands.getAppSettings).mockResolvedValue({
      status: "ok",
      data: mockSettings,
    } as never);

    await useSettingsStore.getState().refreshSettings();

    expect(useSettingsStore.getState().settings).not.toBeNull();
    expect(useSettingsStore.getState().isLoading).toBe(false);
  });

  it("sets isLoading false even on error", async () => {
    vi.mocked(commands.getAppSettings).mockRejectedValue(
      new Error("network error"),
    );

    await useSettingsStore.getState().refreshSettings();

    expect(useSettingsStore.getState().isLoading).toBe(false);
  });
});

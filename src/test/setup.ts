import "@testing-library/jest-dom";

// Mock Tauri API for tests (not available in jsdom)
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/bindings", () => ({
  commands: {
    getAppSettings: vi.fn(),
    getDefaultSettings: vi.fn(),
    changeAudioFeedbackSetting: vi.fn(),
    changeAudioFeedbackVolumeSetting: vi.fn(),
    changeAutostartSetting: vi.fn(),
    changeDebugModeSetting: vi.fn(),
    changePttSetting: vi.fn(),
    setSelectedMicrophone: vi.fn(),
    updateMicrophoneMode: vi.fn(),
    checkCustomSounds: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AccessibilityOnboarding from "./AccessibilityOnboarding";

const toastError = vi.fn();
const initializeEnigo = vi.fn();
const initializeShortcuts = vi.fn();
const mockRefreshAudioDevices = vi.fn();
const mockRefreshOutputDevices = vi.fn();
const platformMock = vi.fn();
const checkAccessibilityPermissionMock = vi.fn();
const requestAccessibilityPermissionMock = vi.fn();
const checkMicrophonePermissionMock = vi.fn();
const requestMicrophonePermissionMock = vi.fn();
const settingsStoreState = {
  refreshAudioDevices: mockRefreshAudioDevices,
  refreshOutputDevices: mockRefreshOutputDevices,
};
const tMock = (key: string) => {
  const translations: Record<string, string> = {
    "onboarding.permissions.title": "Permissions Required",
    "onboarding.permissions.description":
      "VocalType needs a couple of permissions to work properly.",
    "onboarding.permissions.microphone.title": "Microphone Access",
    "onboarding.permissions.microphone.description":
      "Required to hear your voice for transcription.",
    "onboarding.permissions.accessibility.title": "Accessibility Access",
    "onboarding.permissions.accessibility.description":
      "Required to type transcribed text into your applications.",
    "onboarding.permissions.grant": "Grant Permission",
    "onboarding.permissions.waiting": "Waiting...",
    "onboarding.permissions.granted": "Granted",
    "onboarding.permissions.allGranted": "All set!",
    "onboarding.permissions.errors.checkFailed":
      "Failed to check permissions. Please try again.",
    "onboarding.permissions.errors.requestFailed":
      "Failed to request permission. Please try again.",
    "common.back": "Back",
  };
  return translations[key] ?? key;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => platformMock(),
}));

vi.mock("tauri-plugin-macos-permissions-api", () => ({
  checkAccessibilityPermission: () => checkAccessibilityPermissionMock(),
  requestAccessibilityPermission: () => requestAccessibilityPermissionMock(),
  checkMicrophonePermission: () => checkMicrophonePermissionMock(),
  requestMicrophonePermission: () => requestMicrophonePermissionMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/bindings", () => ({
  commands: {
    initializeEnigo: (...args: unknown[]) => initializeEnigo(...args),
    initializeShortcuts: (...args: unknown[]) => initializeShortcuts(...args),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(settingsStoreState),
}));

describe("AccessibilityOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.mockReturnValue("macos");
    checkAccessibilityPermissionMock.mockResolvedValue(false);
    checkMicrophonePermissionMock.mockResolvedValue(false);
    requestAccessibilityPermissionMock.mockResolvedValue(undefined);
    requestMicrophonePermissionMock.mockResolvedValue(undefined);
    mockRefreshAudioDevices.mockResolvedValue(undefined);
    mockRefreshOutputDevices.mockResolvedValue(undefined);
    initializeEnigo.mockResolvedValue(undefined);
    initializeShortcuts.mockResolvedValue(undefined);
  });

  it("shows an error toast when the initial permission check fails", async () => {
    checkAccessibilityPermissionMock.mockRejectedValueOnce(new Error("boom"));

    render(<AccessibilityOnboarding onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Failed to check permissions. Please try again.",
      );
    });
    expect(screen.getAllByText("Grant Permission")).toHaveLength(2);
  });

  it("shows an error toast when microphone permission request is refused", async () => {
    requestMicrophonePermissionMock.mockRejectedValueOnce(new Error("denied"));

    render(<AccessibilityOnboarding onComplete={vi.fn()} />);

    const buttons = await screen.findAllByText("Grant Permission");
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Failed to request permission. Please try again.",
      );
    });
  });

  it("completes once both permissions are granted and refreshes audio devices", async () => {
    const onComplete = vi.fn();
    checkAccessibilityPermissionMock.mockResolvedValue(true);
    checkMicrophonePermissionMock.mockResolvedValue(true);

    render(<AccessibilityOnboarding onComplete={onComplete} />);

    await waitFor(() => {
      expect(mockRefreshAudioDevices).toHaveBeenCalled();
      expect(mockRefreshOutputDevices).toHaveBeenCalled();
    });

    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
  });
});

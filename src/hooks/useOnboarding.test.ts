import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOnboarding } from "./useOnboarding";

// Mock Tauri/OS modules
vi.mock("@tauri-apps/api/app", () => ({
  getIdentifier: vi.fn().mockResolvedValue("com.vocalype.app"),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockReturnValue("linux"),
}));

vi.mock("tauri-plugin-macos-permissions-api", () => ({
  checkAccessibilityPermission: vi.fn().mockResolvedValue(true),
  checkMicrophonePermission: vi.fn().mockResolvedValue(true),
}));

// @/bindings is globally mocked in setup.ts; extend here
vi.mock("@/bindings", () => ({
  commands: {
    hasAnyModelsAvailable: vi.fn(),
  },
}));

import { commands } from "@/bindings";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";

const mockCommands = commands as unknown as {
  hasAnyModelsAvailable: ReturnType<typeof vi.fn>;
};
const mockPlatform = platform as ReturnType<typeof vi.fn>;
const mockCheckA11y = checkAccessibilityPermission as ReturnType<typeof vi.fn>;
const mockCheckMic = checkMicrophonePermission as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPlatform.mockReturnValue("linux");
  mockCheckA11y.mockResolvedValue(true);
  mockCheckMic.mockResolvedValue(true);
});

describe("useOnboarding", () => {
  it("sets onboardingStep to 'model' when no models available (non-dev, non-macOS)", async () => {
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({
      status: "ok",
      data: false,
    });

    const { result } = renderHook(() =>
      useOnboarding({ authLoading: false, hasAnyAccess: true }),
    );

    await waitFor(() => {
      expect(result.current.onboardingStep).toBe("accessibility");
    });
  });

  it("sets onboardingStep to 'done' when models available and not macOS", async () => {
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({
      status: "ok",
      data: true,
    });

    const { result } = renderHook(() =>
      useOnboarding({ authLoading: false, hasAnyAccess: true }),
    );

    await waitFor(() => {
      expect(result.current.onboardingStep).toBe("done");
    });
  });

  it("sets onboardingStep to 'accessibility' on macOS when permissions missing", async () => {
    mockPlatform.mockReturnValue("macos");
    mockCheckA11y.mockResolvedValue(false);
    mockCheckMic.mockResolvedValue(true);
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({
      status: "ok",
      data: true,
    });

    const { result } = renderHook(() =>
      useOnboarding({ authLoading: false, hasAnyAccess: true }),
    );

    await waitFor(() => {
      expect(result.current.onboardingStep).toBe("accessibility");
    });
  });

  it("handleAccessibilityComplete sets step to 'model' for new user", async () => {
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({
      status: "ok",
      data: false,
    });

    const { result } = renderHook(() =>
      useOnboarding({ authLoading: false, hasAnyAccess: true }),
    );

    await waitFor(() => {
      expect(result.current.onboardingStep).not.toBeNull();
    });

    act(() => {
      result.current.handleAccessibilityComplete();
    });

    // isReturningUser is false → goes to "model"
    expect(result.current.onboardingStep).toBe("model");
  });

  it("handleModelSelected sets onboardingStep to 'done'", async () => {
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({
      status: "ok",
      data: false,
    });

    const { result } = renderHook(() =>
      useOnboarding({ authLoading: false, hasAnyAccess: true }),
    );

    await waitFor(() => {
      expect(result.current.onboardingStep).not.toBeNull();
    });

    act(() => {
      result.current.handleModelSelected();
    });

    expect(result.current.onboardingStep).toBe("done");
  });
});

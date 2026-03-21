import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionRefresh } from "./useSessionRefresh";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    getStoredToken: vi.fn(),
    getSession: vi.fn(),
    getErrorStatus: vi.fn(),
  },
}));

import { authClient } from "@/lib/auth/client";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useSessionRefresh", () => {
  const applySession = vi.fn();
  const syncLicenseForSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: no stored token → hook is a no-op
    vi.mocked(authClient.getStoredToken).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call getSession when there is no stored token", () => {
    renderHook(() =>
      useSessionRefresh({ applySession, syncLicenseForSession }),
    );

    vi.advanceTimersByTime(17 * 60 * 1000 + 1);
    expect(authClient.getSession).not.toHaveBeenCalled();
  });

  it("calls getSession on interval when token is present", async () => {
    const fakeSession = { token: "tok" } as never;
    vi.mocked(authClient.getStoredToken).mockReturnValue("tok");
    vi.mocked(authClient.getSession).mockResolvedValue(fakeSession);

    renderHook(() =>
      useSessionRefresh({ applySession, syncLicenseForSession }),
    );

    await vi.advanceTimersByTimeAsync(17 * 60 * 1000 + 1);
    expect(authClient.getSession).toHaveBeenCalledWith("tok");
    expect(applySession).toHaveBeenCalledWith(fakeSession);
  });

  it("calls applySession(null) on 401 during background refresh", async () => {
    const err = new Error("Unauthorized");
    vi.mocked(authClient.getStoredToken).mockReturnValue("tok");
    vi.mocked(authClient.getSession).mockRejectedValue(err);
    vi.mocked(authClient.getErrorStatus).mockReturnValue(401);

    renderHook(() =>
      useSessionRefresh({ applySession, syncLicenseForSession }),
    );

    await vi.advanceTimersByTimeAsync(17 * 60 * 1000 + 1);
    expect(applySession).toHaveBeenCalledWith(null);
  });

  it("triggers a refresh when visibility changes to visible", async () => {
    const fakeSession = { token: "tok" } as never;
    vi.mocked(authClient.getStoredToken).mockReturnValue("tok");
    vi.mocked(authClient.getSession).mockResolvedValue(fakeSession);

    renderHook(() =>
      useSessionRefresh({ applySession, syncLicenseForSession }),
    );

    // Simulate the app coming back to the foreground
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.runAllTimersAsync();
    expect(authClient.getSession).toHaveBeenCalled();
  });

  it("cleans up interval and event listener on unmount", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() =>
      useSessionRefresh({ applySession, syncLicenseForSession }),
    );

    expect(addSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});

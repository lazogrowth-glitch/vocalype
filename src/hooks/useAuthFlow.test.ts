import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuthFlow } from "./useAuthFlow";

// Mock auth & license clients
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    hydrateStoredSession: vi.fn().mockResolvedValue(null),
    getStoredToken: vi.fn().mockReturnValue(null),
    getStoredSession: vi.fn().mockReturnValue(null),
    getStoredRefreshToken: vi.fn().mockReturnValue(null),
    refreshAccessToken: vi.fn(),
    getSession: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    setStoredSession: vi.fn().mockResolvedValue(undefined),
    clearStoredSession: vi.fn().mockResolvedValue(undefined),
    clearStoredToken: vi.fn().mockResolvedValue(undefined),
    getErrorStatus: vi.fn().mockReturnValue(0),
    hasSeenTrialWelcome: vi.fn().mockResolvedValue(false),
    markTrialWelcomeSeen: vi.fn().mockResolvedValue(undefined),
    createCheckout: vi.fn(),
    createPortal: vi.fn(),
  },
}));

vi.mock("@/lib/license/client", () => ({
  licenseClient: {
    clearStoredBundle: vi.fn().mockResolvedValue(undefined),
    getRuntimeState: vi.fn().mockResolvedValue(null),
    issue: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    reportAnomaly: vi.fn().mockResolvedValue(undefined),
    getIntegritySnapshot: vi.fn().mockResolvedValue({ tamper_flags: [] }),
  },
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { authClient } from "@/lib/auth/client";
import { licenseClient } from "@/lib/license/client";

const mockAuthClient = authClient as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const mockLicenseClient = licenseClient as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const t = (key: string) => key;

const defaultRuntimeState = {
  state: "expired" as const,
  reason: null,
  integrity_anomalies: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthClient.hydrateStoredSession.mockResolvedValue(null);
  mockAuthClient.getStoredToken.mockReturnValue(null);
  mockAuthClient.getStoredRefreshToken.mockReturnValue(null);
  mockAuthClient.getSession.mockResolvedValue(null);
  mockAuthClient.getErrorStatus.mockReturnValue(0);
  mockLicenseClient.getRuntimeState.mockResolvedValue(defaultRuntimeState);
  mockLicenseClient.clearStoredBundle.mockResolvedValue(undefined);
});

describe("useAuthFlow — initial state", () => {
  it("starts with authLoading=true", () => {
    const { result } = renderHook(() => useAuthFlow(t));
    expect(result.current.authLoading).toBe(true);
  });

  it("sets authLoading=false after no token found", async () => {
    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => {
      expect(result.current.authLoading).toBe(false);
    });
  });

  it("session is null when no stored session", async () => {
    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.activationStatus).toBe("logged_out");
  });

  it("showTrialWelcome is false initially", async () => {
    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.showTrialWelcome).toBe(false);
  });
});

describe("useAuthFlow — refreshSession", () => {
  it("restores session from storage when token exists", async () => {
    const fakeSession = {
      token: "tok123",
      user: { id: "u1", email: "a@b.com" },
      subscription: {
        status: "active" as const,
        has_access: true,
        tier: "premium" as const,
      },
    };
    mockAuthClient.getStoredToken.mockReturnValue("tok123");
    mockAuthClient.hydrateStoredSession.mockResolvedValue(fakeSession);
    mockAuthClient.getSession.mockResolvedValue(fakeSession);
    mockLicenseClient.getRuntimeState.mockResolvedValue({
      state: "online_valid",
    });

    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.token).toBe("tok123");
    expect(result.current.activationStatus).toBe("ready");
  });

  it("sets authError on 401 from getSession", async () => {
    mockAuthClient.getStoredToken.mockReturnValue("expired-tok");
    mockAuthClient.hydrateStoredSession.mockResolvedValue(null);
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockAuthClient.getSession.mockRejectedValue(err);
    mockAuthClient.getErrorStatus.mockReturnValue(401);

    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.authError).toBe("auth.sessionExpired");
    expect(result.current.activationStatus).toBe("logged_out");
  });

  it("marks subscription inactive when the user is logged in without access", async () => {
    const fakeSession = {
      token: "tok123",
      user: { id: "u1", email: "a@b.com" },
      subscription: {
        status: "inactive" as const,
        has_access: false,
        tier: "basic" as const,
      },
    };
    mockAuthClient.getStoredToken.mockReturnValue("tok123");
    mockAuthClient.hydrateStoredSession.mockResolvedValue(fakeSession);
    mockAuthClient.getSession.mockResolvedValue(fakeSession);

    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.session?.user.email).toBe("a@b.com");
    expect(result.current.activationStatus).toBe("subscription_inactive");
  });
});

describe("useAuthFlow — handleLogout", () => {
  it("clears session on logout", async () => {
    const fakeSession = {
      token: "tok",
      user: { id: "u1", email: "a@b.com" },
      subscription: {
        status: "active" as const,
        has_access: true,
        tier: "premium" as const,
      },
    };
    mockAuthClient.getStoredToken.mockReturnValue("tok");
    mockAuthClient.hydrateStoredSession.mockResolvedValue(fakeSession);
    mockAuthClient.getSession.mockResolvedValue(fakeSession);
    mockLicenseClient.getRuntimeState.mockResolvedValue({
      state: "online_valid",
    });

    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.session).not.toBeNull());

    await act(async () => {
      result.current.handleLogout();
    });

    expect(result.current.session).toBeNull();
    expect(mockAuthClient.clearStoredSession).toHaveBeenCalled();
  });
});

describe("useAuthFlow — handleDismissTrialWelcome", () => {
  it("sets showTrialWelcome to false", async () => {
    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    act(() => {
      result.current.handleDismissTrialWelcome();
    });

    expect(result.current.showTrialWelcome).toBe(false);
  });
});

describe("useAuthFlow — handleLogin", () => {
  it("sets authSubmitting during login", async () => {
    let resolveLogin!: (v: unknown) => void;
    const loginPromise = new Promise((res) => {
      resolveLogin = res;
    });
    mockLicenseClient.issue.mockReturnValue(loginPromise);
    mockAuthClient.login = vi.fn().mockReturnValue(loginPromise);

    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    act(() => {
      void result.current.handleLogin({ email: "a@b.com", password: "pass" });
    });

    expect(result.current.authSubmitting).toBe(true);
    resolveLogin({
      token: "tok",
      user: { id: "1", email: "a@b.com" },
      subscription: { has_access: true, tier: "premium", status: "active" },
    });
  });

  it("sets authError when login fails", async () => {
    mockAuthClient.login = vi
      .fn()
      .mockRejectedValue(new Error("Invalid credentials"));

    const { result } = renderHook(() => useAuthFlow(t));
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    await act(async () => {
      await result.current.handleLogin({ email: "a@b.com", password: "wrong" });
    });

    expect(result.current.authError).toBe("Invalid credentials");
    expect(result.current.authSubmitting).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/plugin-os", () => ({
  type: vi.fn(),
}));

import { type as osTypePlugin } from "@tauri-apps/plugin-os";
import { useOsType } from "./useOsType";

const mockOsType = osTypePlugin as ReturnType<typeof vi.fn>;

describe("useOsType", () => {
  it("returns 'macos' for macOS", () => {
    mockOsType.mockReturnValue("macos");
    expect(useOsType()).toBe("macos");
  });

  it("returns 'windows' for Windows", () => {
    mockOsType.mockReturnValue("windows");
    expect(useOsType()).toBe("windows");
  });

  it("returns 'linux' for Linux", () => {
    mockOsType.mockReturnValue("linux");
    expect(useOsType()).toBe("linux");
  });

  it("returns 'unknown' for iOS", () => {
    mockOsType.mockReturnValue("ios");
    expect(useOsType()).toBe("unknown");
  });

  it("returns 'unknown' for Android", () => {
    mockOsType.mockReturnValue("android");
    expect(useOsType()).toBe("unknown");
  });
});

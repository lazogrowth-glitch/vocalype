import { describe, it, expect } from "vitest";
import { formatModelSize } from "./format";

describe("formatModelSize", () => {
  it("returns 'Unknown size' for null", () => {
    expect(formatModelSize(null)).toBe("Unknown size");
  });

  it("returns 'Unknown size' for undefined", () => {
    expect(formatModelSize(undefined)).toBe("Unknown size");
  });

  it("returns 'Unknown size' for 0", () => {
    expect(formatModelSize(0)).toBe("Unknown size");
  });

  it("returns 'Unknown size' for negative numbers", () => {
    expect(formatModelSize(-100)).toBe("Unknown size");
  });

  it("returns 'Unknown size' for NaN", () => {
    expect(formatModelSize(NaN)).toBe("Unknown size");
  });

  it("formats MB below 100 with one decimal", () => {
    const result = formatModelSize(42.5);
    expect(result).toContain("MB");
    // Locale-agnostic: the number should have a decimal separator (. or ,)
    expect(result).toMatch(/42[.,]5/);
  });

  it("formats MB above 100 without decimal", () => {
    const result = formatModelSize(150);
    expect(result).toContain("MB");
    expect(result).not.toContain(".");
  });

  it("converts 1024 MB to GB", () => {
    const result = formatModelSize(1024);
    expect(result).toContain("GB");
  });

  it("converts large sizes to GB with one decimal when under 10 GB", () => {
    const result = formatModelSize(2048); // 2 GB
    expect(result).toContain("GB");
    expect(result).toContain("2");
  });

  it("formats 10+ GB without decimal", () => {
    const result = formatModelSize(10240); // 10 GB
    expect(result).toContain("GB");
    expect(result).not.toContain(".");
  });
});

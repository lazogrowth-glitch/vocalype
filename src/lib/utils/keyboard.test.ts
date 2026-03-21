import { describe, it, expect } from "vitest";
import { getKeyName, formatKeyCombination, normalizeKey } from "./keyboard";

const makeEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ code: "", key: "", keyCode: 0, which: 0, ...overrides } as KeyboardEvent);

describe("getKeyName", () => {
  it("converts letter code to lowercase", () => {
    expect(getKeyName(makeEvent({ code: "KeyA" }))).toBe("a");
    expect(getKeyName(makeEvent({ code: "KeyZ" }))).toBe("z");
  });

  it("converts digit code to digit string", () => {
    expect(getKeyName(makeEvent({ code: "Digit0" }))).toBe("0");
    expect(getKeyName(makeEvent({ code: "Digit9" }))).toBe("9");
  });

  it("converts function key to lowercase", () => {
    expect(getKeyName(makeEvent({ code: "F1" }))).toBe("f1");
    expect(getKeyName(makeEvent({ code: "F12" }))).toBe("f12");
  });

  it("converts Space code to 'space'", () => {
    expect(getKeyName(makeEvent({ code: "Space" }))).toBe("space");
  });

  it("converts Enter code to 'enter'", () => {
    expect(getKeyName(makeEvent({ code: "Enter" }))).toBe("enter");
  });

  it("converts Escape code to 'esc'", () => {
    expect(getKeyName(makeEvent({ code: "Escape" }))).toBe("esc");
  });

  it("converts MetaLeft to 'super' on non-mac", () => {
    expect(getKeyName(makeEvent({ code: "MetaLeft" }), "windows")).toBe("super");
  });

  it("converts MetaLeft to 'command' on macOS", () => {
    expect(getKeyName(makeEvent({ code: "MetaLeft" }), "macos")).toBe("command");
  });

  it("converts AltLeft to 'option' on macOS", () => {
    expect(getKeyName(makeEvent({ code: "AltLeft" }), "macos")).toBe("option");
  });

  it("converts AltLeft to 'alt' on windows", () => {
    expect(getKeyName(makeEvent({ code: "AltLeft" }), "windows")).toBe("alt");
  });

  it("converts ArrowUp to 'up'", () => {
    expect(getKeyName(makeEvent({ code: "ArrowUp" }))).toBe("up");
  });

  it("falls back to e.key when code is empty", () => {
    expect(getKeyName(makeEvent({ code: "", key: "a" }))).toBe("a");
  });

  it("falls back to unknown when both code and key are empty", () => {
    const result = getKeyName(makeEvent({ code: "", key: "", keyCode: 65 }));
    expect(result).toContain("65");
  });
});

describe("formatKeyCombination", () => {
  it("returns empty string for empty input", () => {
    expect(formatKeyCombination("", "windows")).toBe("");
  });

  it("formats single key", () => {
    expect(formatKeyCombination("space", "windows")).toBe("Space");
  });

  it("formats key combination with +", () => {
    const result = formatKeyCombination("shift+space", "windows");
    expect(result).toBe("Shift + Space");
  });

  it("formats left/right modifier correctly", () => {
    const result = formatKeyCombination("shift_left+a", "windows");
    expect(result).toContain("Left Shift");
  });

  it("formats function key uppercase", () => {
    expect(formatKeyCombination("f1", "windows")).toBe("F1");
  });
});

describe("normalizeKey", () => {
  it("returns key unchanged if no left/right prefix", () => {
    expect(normalizeKey("shift")).toBe("shift");
    expect(normalizeKey("space")).toBe("space");
  });

  it("strips 'left ' prefix", () => {
    expect(normalizeKey("left shift")).toBe("shift");
  });

  it("strips 'right ' prefix", () => {
    expect(normalizeKey("right ctrl")).toBe("ctrl");
  });
});

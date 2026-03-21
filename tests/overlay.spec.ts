import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./helpers/tauriMock";

test.describe("Overlay window", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, { windowLabel: "overlay" });
  });

  test("overlay page loads with HTTP 200", async ({ page }) => {
    const response = await page.goto("/src/overlay/");
    expect(response?.status()).toBe(200);
  });

  test("overlay page has a root element", async ({ page }) => {
    await page.goto("/src/overlay/");
    await expect(page.locator("#root")).toBeAttached();
  });

  test("overlay renders without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/src/overlay/");
    // Allow React to hydrate
    await page.waitForTimeout(1000);
    // Only fail on errors that aren't expected Tauri API unavailability
    const critical = errors.filter(
      (e) =>
        !e.includes("__TAURI_INTERNALS__") &&
        !e.includes("invoke") &&
        !e.includes("plugin") &&
        !e.includes("tauri") &&
        !e.includes("transformCallback"),
    );
    expect(critical).toHaveLength(0);
  });

  test("overlay body has transparent background style", async ({ page }) => {
    await page.goto("/src/overlay/");
    const bg = await page.evaluate(
      () => document.body.style.background || getComputedStyle(document.body).background,
    );
    expect(
      bg.includes("transparent") || bg.includes("rgba(0, 0, 0, 0)"),
    ).toBeTruthy();
  });

  test("overlay root is attached after React hydration", async ({ page }) => {
    await page.goto("/src/overlay/");
    await page.waitForTimeout(1000);
    const root = page.locator("#root");
    await expect(root).toBeAttached();
  });
});

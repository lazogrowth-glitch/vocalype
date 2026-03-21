import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("has correct title", async ({ page }) => {
    await page.goto("/");
    expect(await page.title()).toContain("VocalType");
  });

  test("has html and body elements", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toBeAttached();
    await expect(page.locator("body")).toBeAttached();
  });
});

test.describe("Desktop bootstrap — no Tauri runtime", () => {
  test("desktop page loads with HTTP 200", async ({ page }) => {
    const response = await page.goto("/desktop/");
    expect(response?.status()).toBe(200);
  });

  test("desktop page title is VocalType", async ({ page }) => {
    await page.goto("/desktop/");
    await expect(page).toHaveTitle("VocalType");
  });

  test("startup splash is shown immediately on load", async ({ page }) => {
    await page.goto("/desktop/");
    await expect(page.locator("#startup-splash")).toBeVisible();
  });

  test("shows runtime unavailable message when Tauri is absent", async ({
    page,
  }) => {
    await page.goto("/desktop/");
    await expect(
      page.getByText(/failed to connect to the desktop runtime/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test("root element exists in DOM", async ({ page }) => {
    await page.goto("/desktop/");
    await expect(page.locator("#root")).toBeAttached();
  });
});

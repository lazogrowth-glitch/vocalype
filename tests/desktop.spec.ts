import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./helpers/tauriMock";

test.describe("Desktop app — with mocked Tauri", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, { windowLabel: "main" });
    await page.goto("/desktop/");
  });

  test("splash screen disappears after bootstrap", async ({ page }) => {
    // With Tauri mock, runtime check passes and the app renders
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
  });

  test("does not show the 'failed to connect' error", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    await expect(
      page.getByText(/failed to connect to the desktop runtime/i),
    ).not.toBeVisible();
  });

  test("renders app content in #root", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty();
  });

  test("auth portal renders when no session stored", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    // Auth portal shows Login and Create account tabs
    await expect(page.getByRole("button", { name: "Login", exact: true })).toBeVisible({
      timeout: 8000,
    });
  });

  test("auth portal has Create account tab", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /create account/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test("auth portal has email input field", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toBeVisible({
      timeout: 8000,
    });
  });

  test("auth portal has password input field", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    await expect(page.locator('input[type="password"]')).toBeVisible({
      timeout: 8000,
    });
  });

  test("clicking Create account tab switches mode", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    const createBtn = page.getByRole("button", { name: /create account/i });
    await createBtn.waitFor({ timeout: 8000 });
    await createBtn.click();
    // Register mode shows a name field in addition to email/password
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("email field accepts user input", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    const emailInput = page.locator('input[type="email"]');
    await emailInput.waitFor({ timeout: 8000 });
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");
  });

  test("password field accepts user input", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({ timeout: 10000 });
    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ timeout: 8000 });
    await pwdInput.fill("mypassword123");
    await expect(pwdInput).toHaveValue("mypassword123");
  });
});

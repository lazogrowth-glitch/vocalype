import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./helpers/tauriMock";

test.describe("Desktop app — with mocked Tauri", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, { windowLabel: "main" });
    await page.goto("/desktop/");
  });

  test("splash screen disappears after bootstrap", async ({ page }) => {
    // With Tauri mock, runtime check passes and the app renders
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
  });

  test("does not show the 'failed to connect' error", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByText(/failed to connect to the desktop runtime/i),
    ).not.toBeVisible();
  });

  test("renders app content in #root", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty();
  });

  test("auth portal renders browser sign-in when no session stored", async ({
    page,
  }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByRole("heading", { name: "Connectez-vous." }),
    ).toBeVisible();
    await expect(page.getByText(/connexion dans le navigateur/i)).toBeVisible();
  });

  test("auth portal has create-account browser CTA", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: /creer un compte/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test("auth portal has existing-account browser CTA", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: /j'ai deja un compte/i }),
    ).toBeVisible({
      timeout: 8000,
    });
  });

  test("auth portal has legal links", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: "Conditions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confidentialite" }),
    ).toBeVisible();
  });

  test("clicking Create account stays on auth portal", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    const createBtn = page.getByRole("button", { name: /creer un compte/i });
    await createBtn.waitFor({ timeout: 8000 });
    await createBtn.click();
    await expect(
      page.getByRole("heading", { name: "Connectez-vous." }),
    ).toBeVisible();
  });

  test("auth portal does not show inline email form", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });

  test("auth portal does not show inline password form", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});

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

  test("auth portal renders inline sign-in when no session stored", async ({
    page,
  }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(page.getByRole("heading", { name: "Bon retour." })).toBeVisible();
    await expect(page.getByText(/vocalype s'active automatiquement/i)).toBeVisible();
  });

  test("auth portal has auth mode toggles", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.locator(".auth-seg").getByRole("button", { name: /se connecter/i }),
    ).toBeVisible();
    await expect(
      page.locator(".auth-seg").getByRole("button", { name: /créer un compte/i }),
    ).toBeVisible();
  });

  test("auth portal shows inline email and password fields", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(page.locator('input[type="email"]')).toHaveCount(1);
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
  });

  test("auth portal has legal links", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: "Conditions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Politique de confidentialité" }),
    ).toBeVisible();
  });

  test("clicking Create account switches the auth panel to signup", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    const createBtn = page.getByRole("button", { name: /créer un compte/i });
    await createBtn.waitFor({ timeout: 8000 });
    await createBtn.click();
    await expect(
      page.getByRole("heading", { name: "Crée ton compte." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Créer mon compte" })).toBeVisible();
  });

  test("sign-in form has forgot-password shortcut", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: /mot de passe oublié/i }),
    ).toBeVisible();
  });

  test("sign-in submit button is present", async ({ page }) => {
    await expect(page.locator("#startup-splash")).toBeHidden({
      timeout: 10000,
    });
    await expect(
      page.locator("form").getByRole("button", { name: "Se connecter" }),
    ).toBeVisible();
  });
});

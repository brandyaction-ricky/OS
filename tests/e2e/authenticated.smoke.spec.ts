import { expect, test } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const email = process.env.E2E_TEST_EMAIL?.trim();
const password = process.env.E2E_TEST_PASSWORD;
const connectedQaConfigured = Boolean(baseURL && email && password);

test.describe("connected DEV or QA", () => {
  test.skip(!connectedQaConfigured, "PLAYWRIGHT_BASE_URL and dedicated E2E test credentials are required");

  test("an isolated test account can sign in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email!);
    await page.locator('input[type="password"]').fill(password!);
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await expect(page).toHaveURL(/\/home(?:\?.*)?$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("내 할 일");
    await expect(page.getByText("API·DB 응답 확인", { exact: true })).toBeVisible();
  });
});

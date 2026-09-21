import { expect, test } from "@playwright/test";

test("technical document QA page stays closed in local demo", async ({ page }) => {
  const response = await page.goto("/knowledge/preflight");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "문서 읽기·버전 확인" })).toHaveCount(0);
});

test("preflight stays closed in the credential-free local demo", async ({ request }) => {
  const response = await request.post("/api/v1/system-one/preflight", { data: {} });
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers().vary).toContain("Authorization");
  await expect(response.json()).resolves.toEqual({ status: "stopped", code: "not_enabled" });
});

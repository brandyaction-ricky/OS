import { expect, test } from "@playwright/test";

test("planning handoff does not leak into the credential-free demo", async ({ page }) => {
  await page.goto("/content/scripts?sourceId=00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("heading", { name: "원고·스크립트", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "기획에서 제작으로 인계" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "최신 기획 메모 다시 읽기" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "집필 전 자료 다시 확인" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "설계표·원고 문서 연결" })).toHaveCount(0);
});

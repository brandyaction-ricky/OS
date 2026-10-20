import { expect, test } from "@playwright/test";

test("OS longform import is visible but cannot claim a live connection in demo mode", async ({ page, request }, testInfo) => {
  await page.goto("/content/shorts?topic=demo-final-topic");
  await expect(page.getByRole("heading", { level: 1, name: "숏폼 편집", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "OS 롱폼 완성본 불러오기", exact: true })).toBeDisabled();
  await expect(page.getByText("③에서 완성한 롱폼 영상과 자막을 재업로드 없이 불러옵니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "시간 자막 원문", exact: true })).toBeVisible();
  const denied = await request.get("/api/v1/content/shorts/longform?sourceId=00000000-0000-4000-8000-000000000010");
  expect(denied.status()).toBe(401);
  await page.screenshot({ path: testInfo.outputPath("longform-source-demo.png"), fullPage: true });
});

test("shortform rendering and card imports require a signed-in user", async ({ request }) => {
  const id = "00000000-0000-4000-8000-000000000010";
  expect((await request.get(`/api/v1/content/shorts/render?itemId=${id}`)).status()).toBe(401);
  expect((await request.post("/api/v1/content/shorts/render", { data: { itemId: id, version: 1, confirmVoiceCost: true } })).status()).toBe(401);
  expect((await request.post("/api/v1/content/shorts/cards", { data: { sourceId: id, sourceKey: "demo", clipIds: [id] } })).status()).toBe(401);
});

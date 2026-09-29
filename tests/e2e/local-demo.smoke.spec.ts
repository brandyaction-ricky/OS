import { expect, test } from "@playwright/test";

test("local demo renders the application shell and health contract", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/home");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("이번 주 핵심만 모았습니다");
  await expect(page.getByText("데모 데이터", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "지식 찾기" })).toBeVisible();

  const healthResponse = await request.get("/api/v1/health");
  expect(healthResponse.status()).toBe(200);
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "brandyaction-os",
    database: "missing",
    auth: "missing",
  });

  expect(consoleErrors).toEqual([]);
});

test("knowledge editing previews Markdown immediately and exposes file drop", async ({ page }) => {
  await page.route("https://example.com/preview.png", async (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  }));
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "회사 wiki 2" }).click();
  await page.getByRole("button", { name: "정본 편집" }).click();
  await page.getByRole("button", { name: "내용을 확인했고 편집하기" }).click();

  await page.getByRole("textbox", { name: "문서 본문" }).fill("## 큰 제목\n\n### 소제목\n\n- 목록\n\n> 인용문\n\n![바로 보이는 이미지](https://example.com/preview.png)");
  const preview = page.getByRole("region", { name: "실시간 미리보기" });
  await expect(preview.getByRole("heading", { name: "큰 제목", level: 2 })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "소제목", level: 3 })).toBeVisible();
  await expect(preview.getByRole("list").getByText("목록", { exact: true })).toBeVisible();
  await expect(preview.getByText("인용문", { exact: true })).toBeVisible();
  await expect(preview.getByRole("img", { name: "바로 보이는 이미지" })).toBeVisible();

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["preview"], "preview.png", { type: "image/png" }));
    return transfer;
  });
  const editor = page.locator(".document-editor");
  await editor.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("여기에 놓아 자료 첨부", { exact: true })).toBeVisible();
  await editor.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("데모 화면에서는 파일을 올릴 수 없습니다.", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const [sourceBox, previewBox, viewportWidth] = await Promise.all([
    page.getByRole("region", { name: "마크다운 작성 영역" }).boundingBox(),
    preview.boundingBox(),
    page.evaluate(() => document.documentElement.clientWidth),
  ]);
  expect(sourceBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height - 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
});

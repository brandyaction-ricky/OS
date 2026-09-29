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

test("knowledge tree supports context actions and direct drag moves", async ({ page }) => {
  await page.goto("/knowledge");

  const companyFolder = page.getByRole("button", { name: "회사 wiki 2" });
  await page.getByRole("button", { name: /회사 wiki/ }).first().dispatchEvent("contextmenu", { clientX: 240, clientY: 220 });
  const folderMenu = page.getByRole("menu", { name: "회사 wiki 폴더 메뉴" });
  await expect(folderMenu.getByRole("menuitem", { name: "이름·위치 변경" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "이 폴더에 새 문서" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "폴더 문서 휴지통으로" })).toBeVisible();
  await folderMenu.getByRole("menuitem", { name: "이름·위치 변경" }).click();
  await expect(page.getByRole("heading", { name: "폴더 관리", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "폴더 관리 닫기" }).click();

  await companyFolder.click();
  await page.getByRole("button", { name: "채널 운영 1" }).click();
  const documentRow = page.getByRole("button", { name: /패키징 원칙/ });
  await documentRow.dispatchEvent("contextmenu", { clientX: 260, clientY: 300 });
  const documentMenu = page.getByRole("menu", { name: "패키징 원칙 문서 메뉴" });
  await expect(documentMenu.getByRole("menuitem", { name: "이름 변경" })).toBeVisible();
  await expect(documentMenu.getByRole("menuitem", { name: "위치 이동" })).toBeVisible();
  await expect(documentMenu.getByRole("menuitem", { name: "휴지통으로 이동" })).toBeVisible();
  await documentMenu.getByRole("menuitem", { name: "이름 변경" }).click();
  await page.getByRole("textbox", { name: "새 문서 이름" }).fill("패키징 원칙 변경");
  await page.getByRole("button", { name: "이름 변경", exact: true }).click();
  const renamedRow = page.getByRole("button", { name: /패키징 원칙 변경/ });
  await expect(renamedRow).toBeVisible();

  await renamedRow.dragTo(page.getByRole("button", { name: "리키 1" }));
  await expect(page.getByText("문서를 리키\(으\)로 이동했습니다.")).toBeVisible();

  const ipFolder = page.getByRole("button", { name: "핵심 IP 1" });
  const folderTransfer = await page.evaluateHandle(() => new DataTransfer());
  await ipFolder.dispatchEvent("dragstart", { dataTransfer: folderTransfer });
  const rickyFolder = page.getByRole("button", { name: "리키 2" });
  await rickyFolder.dispatchEvent("dragenter", { dataTransfer: folderTransfer });
  await rickyFolder.dispatchEvent("drop", { dataTransfer: folderTransfer });
  await expect(page.getByText("변경 후 위치 · 리키/핵심 IP", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "폴더 관리 닫기" }).click();

  await renamedRow.dispatchEvent("contextmenu", { clientX: 260, clientY: 300 });
  await page.getByRole("menuitem", { name: "휴지통으로 이동" }).click();
  const archiveDialog = page.getByRole("dialog", { name: "휴지통으로 이동" });
  await expect(archiveDialog.getByText("본문과 변경 이력은 보존되며", { exact: false })).toBeVisible();
  await archiveDialog.getByRole("button", { name: "휴지통으로 이동" }).click();
  await expect(page.getByText(/휴지통으로 이동했습니다/)).toBeVisible();

  await page.getByRole("button", { name: /회사 wiki/ }).first().dispatchEvent("contextmenu", { clientX: 240, clientY: 220 });
  await page.getByRole("menuitem", { name: "폴더 문서 휴지통으로" }).click();
  await expect(page.getByRole("heading", { name: "폴더를 정리할까요?" })).toBeVisible();
  await page.getByRole("button", { name: "폴더 문서 휴지통으로", exact: true }).click();
  await expect(page.getByText("2개 문서를 휴지통으로 옮겨 폴더를 정리했습니다.", { exact: true })).toBeVisible();
});

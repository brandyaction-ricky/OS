import { expect, test } from "@playwright/test";

test("local demo renders the application shell and health contract", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/home");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("내 할 일");
  await expect(page.getByText("데모 · 실제 업무 연결 전", { exact: true })).toBeVisible();
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

test("secondary publishing pages keep the content navigation context", async ({ page }) => {
  for (const [pathname] of [
    ["/content/automation", "멀티채널 자동화"],
    ["/content/review", "검토·발행 대기목록"],
    ["/content/calendar", "발행 캘린더"],
  ]) {
    await page.goto(pathname);
    await expect(page.getByRole("button", { name: "콘텐츠", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".breadcrumbs")).toContainText("발행 일정");
    await expect(page.getByRole("link", { name: "발행 일정", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle("발행 일정 | 브랜디 OS");
  }
});

test("knowledge editing applies Markdown shortcuts in one pane and exposes file drop", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "회사 wiki 2" }).click();
  await page.getByRole("button", { name: "정본 편집" }).click();
  await page.getByRole("button", { name: "내용을 확인했고 편집하기" }).click();

  const richEditor = page.getByRole("textbox", { name: "editable markdown" });
  const richToolbar = page.getByRole("toolbar");
  await expect(richToolbar.getByRole("combobox", { name: "문단 형식" })).toBeVisible();
  await expect(richToolbar.getByRole("radio", { name: "굵게" })).toBeVisible();
  await expect(richToolbar.getByRole("button", { name: "표" })).toBeVisible();
  await expect(richToolbar).toHaveCSS("display", "flex");
  await expect(richToolbar).toHaveCSS("flex-direction", "row");
  await richEditor.click();
  await richEditor.press("ControlOrMeta+A");
  await richEditor.press("Backspace");
  await richEditor.pressSequentially("##");
  await richEditor.press("Space");
  await richEditor.pressSequentially("큰 제목");
  await expect(richEditor.getByRole("heading", { name: "큰 제목", level: 2 })).toBeVisible();
  await richEditor.press("Enter");
  await richEditor.pressSequentially("-");
  await richEditor.press("Space");
  await richEditor.pressSequentially("목록");
  await expect(richEditor.getByRole("list").getByText("목록", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OS 문서 연결" }).click();
  const linkDialog = page.getByRole("dialog", { name: "문서 링크 자동완성" });
  await linkDialog.getByRole("button", { name: /6대 욕구 정본/ }).click();
  await expect(richEditor).toContainText("6대 욕구 정본");

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["preview"], "preview.png", { type: "image/png" }));
    return transfer;
  });
  const editor = page.locator(".document-editor");
  const headingBox = await richEditor.getByRole("heading", { name: "큰 제목", level: 2 }).boundingBox();
  expect(headingBox).not.toBeNull();
  const dropPoint = {
    clientX: headingBox!.x + headingBox!.width - 3,
    clientY: headingBox!.y + headingBox!.height + 2,
  };
  await editor.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("여기에 놓아 자료 첨부", { exact: true })).toBeVisible();
  await editor.dispatchEvent("dragover", { dataTransfer, ...dropPoint });
  await expect(page.locator(".knowledge-image-drop-indicator")).toBeVisible();
  await editor.dispatchEvent("drop", { dataTransfer, ...dropPoint });
  await expect(page.getByText("데모 화면에서는 파일을 올릴 수 없습니다.", { exact: true })).toBeVisible();
  await richEditor.pressSequentially("드롭 위치");
  await expect(richEditor.getByRole("heading", { level: 2 })).not.toContainText("드롭 위치");
  const dropBlocks = await richEditor.locator(":scope > *").evaluateAll((elements) => elements.slice(0, 3).map((element) => ({
    tag: element.tagName,
    text: element.textContent,
  })));
  expect(dropBlocks).toEqual([
    { tag: "H2", text: "큰 제목" },
    { tag: "P", text: "드롭 위치" },
    { tag: "UL", text: "목록[[6대 욕구 정본]]" },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  const [editorBox, viewportWidth] = await Promise.all([
    page.getByRole("region", { name: "문서 바로 편집 영역" }).boundingBox(),
    page.evaluate(() => document.documentElement.clientWidth),
  ]);
  expect(editorBox).not.toBeNull();
  expect(editorBox!.width).toBeLessThanOrEqual(viewportWidth);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("button", { name: "6대 욕구 정본" })).toBeVisible();
});

test("knowledge images can be dragged between document blocks", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "회사 wiki 2" }).click();
  await page.getByRole("button", { name: "정본 편집" }).click();
  await page.getByRole("button", { name: "내용을 확인했고 편집하기" }).click();

  const richEditor = page.getByRole("textbox", { name: "editable markdown" });
  await richEditor.click();
  await richEditor.press("ControlOrMeta+A");
  await richEditor.press("Backspace");
  await richEditor.pressSequentially("##");
  await richEditor.press("Space");
  await richEditor.pressSequentially("이동 기준");
  await richEditor.press("Enter");
  await richEditor.pressSequentially("아래 문단");
  await richEditor.press("Enter");
  await richEditor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", '<img src="/favicon.ico" alt="이동할 이미지">');
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });

  const image = richEditor.getByRole("img", { name: "이동할 이미지" });
  await expect(image).toHaveAttribute("draggable", "true");
  await image.click();
  await image.dragTo(richEditor.getByRole("heading", { name: "이동 기준", level: 2 }), {
    targetPosition: { x: 40, y: 25 },
  });
  await expect(page.getByText("여기에 놓아 자료 첨부", { exact: true })).toBeHidden();
  const blocks = await richEditor.locator(":scope > *").evaluateAll((elements) => elements.map((element) => ({
    tag: element.tagName,
    image: Boolean(element.querySelector("img")),
  })));
  expect(blocks.slice(0, 3)).toEqual([
    { tag: "H2", image: false },
    { tag: "P", image: true },
    { tag: "P", image: false },
  ]);
});

test("knowledge gallery browses local demo documents and stops image recovery before upload", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "회사 wiki 2" }).click();
  await page.getByRole("button", { name: "채널 운영 1" }).click();
  await page.getByRole("button", { name: "갤러리 보기" }).click();

  await expect(page.getByRole("heading", { name: "회사 wiki/채널 운영" })).toBeVisible();
  await expect(page.locator(".knowledge-gallery-grid").getByRole("button", { name: /패키징 원칙/ })).toBeVisible();
  await page.getByRole("button", { name: "표", exact: true }).click();
  await expect(page.getByRole("table").getByText("패키징 원칙")).toBeVisible();
  await page.getByRole("textbox", { name: "갤러리 문서 검색" }).fill("피하고 싶은 위험");
  await expect(page.getByRole("table").getByText("패키징 원칙")).toBeVisible();
  await page.getByRole("textbox", { name: "갤러리 문서 검색" }).fill("없는 문서");
  await expect(page.getByText("조건에 맞는 문서가 없습니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "초기화" }).click();

  await page.getByRole("button", { name: "원본 이미지 복원" }).click();
  const recovery = page.locator(".knowledge-image-recovery");
  await expect(recovery.getByRole("heading", { name: "원본 이미지 복원" })).toBeVisible();
  await expect(recovery.getByText("현재 범위에 연결이 필요한 로컬 이미지가 없습니다.", { exact: true })).toBeVisible();
  await expect(recovery.getByRole("button", { name: "0개 이미지 연결" })).toBeDisabled();
});

test("knowledge tree keeps controls compact and mobile actions readable", async ({ page }) => {
  await page.goto("/knowledge");

  await expect(page.getByRole("button", { name: "폴더 안 문서 정렬" })).toBeVisible();
  await expect(page.getByRole("button", { name: "목록 새로고침" })).toBeVisible();
  const folder = page.getByRole("button", { name: "회사 wiki 2" });
  const actions = page.getByRole("button", { name: "회사 wiki 폴더 작업" });
  await expect(folder).toHaveCSS("height", "34px");
  await expect(actions).toHaveCSS("opacity", "0");
  await folder.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await actions.click();
  await expect(page.getByRole("menu", { name: "회사 wiki 폴더 메뉴" }).getByRole("menuitem", { name: "이 폴더에 새 문서" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace-page-header .header-actions")).toHaveCSS("display", "grid");
  const treeWidth = await page.locator(".knowledge-tree-pane").evaluate((pane) => pane.getBoundingClientRect().width);
  expect(treeWidth).toBeGreaterThan(340);
  const importButton = page.getByRole("button", { name: "Markdown 가져오기" });
  await expect(importButton).toBeVisible();
  const layout = await importButton.evaluate((button) => ({ width: button.getBoundingClientRect().width, overflow: button.scrollWidth > button.clientWidth }));
  expect(layout.width).toBeGreaterThan(150);
  expect(layout.overflow).toBe(false);
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

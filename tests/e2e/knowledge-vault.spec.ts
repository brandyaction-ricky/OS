import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});
for (const width of [1440, 1024, 390]) test(`document vault at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/knowledge/vault");
  await expect(page.getByRole("heading", { name: "문서 보관함", exact: true }).first()).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "보기 범위" })).toHaveValue("all");
  await expect(page.locator(".vault-count")).toHaveText("4");
  await expect(page.getByRole("table", { name: "폴더 내용" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "목차와 문서 정보" })).toHaveCount(0);
  await page.getByRole("button", { name: "목차·정보 패널" }).click();
  await expect(page.getByRole("complementary", { name: "목차와 문서 정보" })).toBeVisible();
  await page.getByRole("button", { name: "패널 닫기" }).click();
  await expect(page.getByRole("complementary", { name: "목차와 문서 정보" })).toHaveCount(0);
  if (width < 900) await page.getByRole("button", { name: "파일 트리 보기", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "회사 wiki 3", exact: true })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "리키 1", exact: true })).toBeVisible();
  // Wait for the mobile drawer transition and verify text isn't clipped off-screen.
  await expect.poll(async () => (await page.getByRole("treeitem", {name:"회사 wiki 3",exact:true}).boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`vault-${width}.png`), fullPage: true });
  expect(errors).toEqual([]);
});

test("desktop vault keeps its tree visible even with a saved hidden-tree preference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("brandy-knowledge-vault-tree", "false"));
  await page.goto("/knowledge/vault");
  await expect(page.getByRole("combobox", { name: "보기 범위" })).toHaveValue("all");
  await expect(page.locator(".vault-count")).toHaveText("4");
  await expect(page.getByRole("treeitem", { name: "회사 wiki 3", exact: true })).toBeVisible();
});

test("vault toolbar tracks the resized tree and keeps its count next to the scope", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge/vault");
  const resize = page.getByRole("separator", { name: "파일 트리 폭" });
  await resize.focus();
  await resize.press("ArrowRight");
  await expect.poll(async () => {
    const [top, tree, scope, count] = await Promise.all([
      page.locator(".vault-toolbar-tree").boundingBox(),
      page.locator(".knowledge-tree-pane").boundingBox(),
      page.getByRole("combobox", { name: "보기 범위" }).boundingBox(),
      page.locator(".vault-count").boundingBox(),
    ]);
    return Boolean(top && tree && scope && count && Math.abs(top.width-tree.width)<2 && count.x-scope.x-scope.width<8);
  }).toBe(true);
});

test("vault reader and new-page editor share a bounded writing column", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("brandy-os-theme", "dark"));
  await page.goto("/knowledge/vault?document=demo-packaging");
  await expect(page.locator(".document-reader h1")).toHaveText("패키징 원칙");
  await expect(page.locator(".vault-reader-meta")).toContainText("회사 wiki/채널 운영");
  await expect.poll(async () => {
    const [title, body] = await Promise.all([page.locator(".document-reader h1").boundingBox(), page.locator(".vault-reader-content").boundingBox()]);
    return Boolean(title && body && Math.abs(title.x-body.x)<2 && body.width<=721);
  }).toBe(true);
  await page.screenshot({ path: info.outputPath("vault-reader-column.png"), fullPage: true, mask: [page.locator(".profile-trigger")] });
  await page.locator(".vault-toolbar").getByRole("button", { name: "새 페이지", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "새 페이지 제목" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".knowledge-page-title").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(26);
  await expect.poll(async () => (await page.locator(".knowledge-new-canvas-body").boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(821);
  await page.screenshot({ path: info.outputPath("vault-new-page-column.png"), fullPage: true, mask: [page.locator(".profile-trigger")] });
});

test("entering the vault keeps the company document menu visible while opening a folder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge/vault");
  const sidebar = page.getByRole("complementary", { name: "주요 메뉴" });
  await expect(sidebar.getByRole("link", { name: "문서 보관함" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "사이드바 접기" })).toBeVisible();
  await page.getByRole("treeitem", { name: "회사 wiki 3", exact: true }).click();
  await expect(page).toHaveURL(/folder=/);
  await expect(sidebar.getByRole("link", { name: "문서 보관함" })).toBeVisible();
  await expect(page.getByRole("table", { name: "폴더 내용" })).toBeVisible();
});

for (const width of [1024, 1440]) test(`vault restores its desktop columns after a mobile transition at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/knowledge/vault");
  await expect(page.locator(".vault-count")).toHaveText("4");
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator(".vault-workspace")).toHaveClass(/tree-hidden/);
  await page.setViewportSize({ width, height: 900 });
  await expect(page.locator(".vault-workspace")).not.toHaveClass(/tree-hidden/);
  const tree = page.locator(".knowledge-tree-pane");
  const editor = page.locator(".editor-pane");
  await expect.poll(async () => {
    const [treeBox, editorBox] = await Promise.all([tree.boundingBox(), editor.boundingBox()]);
    return Boolean(treeBox && editorBox && editorBox.x >= treeBox.x + treeBox.width - 1 && editorBox.width > 300);
  }).toBe(true);
  await page.getByRole("table", { name: "폴더 내용" }).getByRole("button", { name: "회사 wiki 폴더 열기", exact: true }).click();
  await expect(page).toHaveURL(/folder=/);
  await expect(page.getByRole("table", { name: "폴더 내용" })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`vault-restored-${width}.png`), fullPage: true });
});

test("desktop document finder keeps the vault tree beside the document", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge/vault");
  await page.getByRole("button", { name: "문서·폴더 찾기", exact: true }).click();
  const finder = page.getByRole("dialog", { name: "문서 찾기" });
  await finder.locator(".p2-document-list > button").first().click();
  await expect(finder).toHaveCount(0);
  await expect(page).toHaveURL(/document=/);
  await expect(page.locator(".vault-workspace")).not.toHaveClass(/tree-hidden/);
  await expect(page.locator(".document-reader h1")).toBeVisible();
  await expect.poll(async () => {
    const [treeBox, editorBox] = await Promise.all([page.locator(".knowledge-tree-pane").boundingBox(), page.locator(".editor-pane").boundingBox()]);
    return Boolean(treeBox && editorBox && editorBox.x >= treeBox.x + treeBox.width - 1);
  }).toBe(true);
});

test("folder table matches the reference and reuses selection, menus and folder creation", async ({ page }, info) => {
  await page.setViewportSize({ width: 1804, height: 960 });
  await page.addInitScript(() => localStorage.setItem("brandy-os-theme", "light"));
  await page.goto("/knowledge/vault");
  await page.getByRole("table", { name: "폴더 내용" }).getByRole("button", { name: "회사 wiki 폴더 열기", exact: true }).click();
  await page.getByRole("button", { name: "운영 원칙 폴더 열기", exact: true }).click();
  const table = page.getByRole("table", { name: "폴더 내용" });
  for (const name of ["이름", "상태", "소유자", "수정"]) await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("time").first()).toHaveAttribute("datetime", /\d{4}-/);
  await table.locator("tbody input[type=checkbox]").first().check();
  await expect(page.getByRole("region", { name: "선택한 문서 작업" })).toContainText("1개 선택");
  await table.getByRole("checkbox", { name: "이 폴더 문서 전체 선택" }).check();
  await expect(page.getByRole("region", { name: "선택한 문서 작업" })).toContainText("1개 선택");
  await page.getByRole("button", { name: "선택 해제", exact: true }).click();
  await table.getByRole("button", { name: /문서 추가 작업$/ }).first().click();
  await expect(page.getByRole("menuitem", { name: /^이름 변경/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".vault-folder-tools").getByRole("button", { name: "새 폴더", exact: true }).click();
  await page.getByRole("textbox", { name: "새 폴더 이름" }).fill("QA 하위 폴더");
  await page.getByRole("textbox", { name: "새 폴더 이름" }).press("Enter");
  await expect(page.getByRole("treeitem", {name:"QA 하위 폴더 빈 폴더",exact:true})).toBeVisible();
  await expect(page.locator(".knowledge-new-canvas")).toHaveCount(0);
  await expect(page.locator(".vault-count")).toHaveText("4");
  const switcher = page.getByRole("group", { name: "폴더 보기 방식" });
  await switcher.getByRole("button", { name: "갤러리", exact: true }).click();
  await expect(switcher.getByRole("button", { name: "갤러리", exact: true })).toHaveAttribute("aria-pressed", "true");
  await switcher.getByRole("button", { name: "목록", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("vault-folder-table-light.png"), fullPage: true, mask: [page.locator(".profile-trigger")] });
});

async function readPreview(page:Page) {
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await page.getByRole("button",{name:"읽기 미리보기",exact:true}).click();
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
}

async function create(page: Page, title: string, content: string) {
  await page.locator(".vault-toolbar").getByRole("button", { name: "새 페이지", exact: true }).click();
  await page.getByRole("textbox", { name: "새 페이지 제목" }).fill(title);
  await page.getByRole("textbox", { name: "editable markdown", exact: true }).fill(content);
  await page.locator(".vault-property-chips summary").filter({hasText:"폴더 ·"}).click();
  await page.getByRole("region",{name:"저장 위치",exact:true}).getByRole("textbox",{name:"저장 위치 검색"}).fill("02_Wiki");
  await page.getByRole("region",{name:"저장 위치",exact:true}).getByRole("treeitem",{name:"02_Wiki",exact:true}).click();
  await page.locator(".vault-property-chips summary").filter({hasText:"폴더 ·"}).click();
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page).toHaveURL(/document=[a-f0-9-]{36}/);
  const id = new URL(page.url()).searchParams.get("document")!;
  await readPreview(page);
  return id;
}

test("UUID links reopen the same document after folder move and title change", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/knowledge/vault");
  const id = await create(page, "QA 원본 문서", "원본 기록");
  const reference = await create(page, "QA 연결 문서", `[[${id}|원본 열기]]`);
  await page.locator(".document-reader").getByRole("button", { name: "원본 열기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`document=${id}`));
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await page.getByRole("button", { name: "위치 이동", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "페이지 위치 이동" });
  await dialog.getByRole("textbox",{name:"이동할 폴더 검색"}).fill("05_Projects");
  await dialog.getByRole("treeitem",{name:"05_Projects",exact:true}).click();
  await dialog.getByRole("button", { name: "위치 이동", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  if (await page.getByRole("button",{name:"본문 입력으로",exact:true}).isVisible()) await page.getByRole("button",{name:"본문 입력으로",exact:true}).click();
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill("QA 이름 변경 후");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await readPreview(page);
  await expect(page.locator(".document-reader h1")).toHaveText("QA 이름 변경 후");
  // Use the existing source row, not a newly-created replacement or path-based link.
  await page.getByRole("treeitem").filter({ hasText: "QA 연결 문서" }).click();
  await expect(page).toHaveURL(new RegExp(`document=${reference}`));
  await readPreview(page);
  await page.locator(".document-reader").getByRole("button", { name: "원본 열기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`document=${id}`));
  await readPreview(page);
  await expect(page.locator(".document-reader h1")).toHaveText("QA 이름 변경 후");
  await expect(page.getByRole("treeitem").filter({hasText:"QA 이름 변경 후"})).toBeVisible();
  await page.screenshot({ path: info.outputPath("vault-id-link-after-move.png"), fullPage:true });
});

import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});
for (const width of [1440, 1024, 390]) test(`document vault at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/knowledge/vault");
  await expect(page.getByRole("heading", { name: "문서 보관함", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "전체", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "전체 문서 4개" })).toBeVisible();
  if (width < 900) await page.locator(".empty-state").getByRole("button", { name: "파일 트리 보기" }).click();
  await expect(page.getByRole("treeitem", { name: "회사 wiki 3", exact: true })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "리키 1", exact: true })).toBeVisible();
  // Wait for the mobile drawer transition and verify text isn't clipped off-screen.
  await expect.poll(async () => (await page.getByRole("treeitem", {name:"회사 wiki 3",exact:true}).boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`vault-${width}.png`), fullPage: true });
  expect(errors).toEqual([]);
});

test("saved hidden tree still shows the document count and a way to reopen it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("brandy-knowledge-vault-tree", "false"));
  await page.goto("/knowledge/vault");
  await expect(page.getByRole("button", { name: "전체", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "전체 문서 4개" })).toBeVisible();
  await page.locator(".empty-state").getByRole("button", { name: "파일 트리 보기" }).click();
  await expect(page.getByRole("treeitem", { name: "회사 wiki 3", exact: true })).toBeVisible();
});

async function create(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "새 페이지", exact: true }).click();
  await page.getByRole("textbox", { name: "새 페이지 제목" }).fill(title);
  await page.getByRole("textbox", { name: "editable markdown", exact: true }).fill(content);
  await page.getByText("페이지 정보 · 폴더, 담당 팀, 브랜드, 태그", { exact: true }).click();
  await page.getByLabel("저장 위치", { exact: true }).selectOption("02_Wiki");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page).toHaveURL(/document=[a-f0-9-]{36}/);
  const id = new URL(page.url()).searchParams.get("document")!;
  await page.getByRole("button", { name: "읽기", exact: true }).click();
  return id;
}

test("UUID links reopen the same document after folder move and title change", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/knowledge/vault");
  const id = await create(page, "QA 원본 문서", "원본 기록");
  const reference = await create(page, "QA 연결 문서", `[[${id}|원본 열기]]`);
  await page.locator(".document-reader").getByRole("button", { name: "원본 열기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`document=${id}`));
  await page.getByRole("button", { name: "위치 이동", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "페이지 위치 이동" });
  await dialog.getByLabel("이동할 폴더", { exact: true }).selectOption("05_Projects");
  await dialog.getByRole("button", { name: "위치 이동", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill("QA 이름 변경 후");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".document-reader h1")).toHaveText("QA 이름 변경 후");
  // Use the existing source row, not a newly-created replacement or path-based link.
  await page.getByRole("treeitem").filter({ hasText: "QA 연결 문서" }).click();
  await expect(page).toHaveURL(new RegExp(`document=${reference}`));
  await page.locator(".document-reader").getByRole("button", { name: "원본 열기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`document=${id}`));
  await expect(page.locator(".document-reader h1")).toHaveText("QA 이름 변경 후");
  if (await page.getByRole("button", {name:"파일 트리 보기",exact:true}).isVisible())
    await page.getByRole("button", {name:"파일 트리 보기",exact:true}).click();
  await expect(page.getByRole("treeitem").filter({hasText:"QA 이름 변경 후"})).toBeVisible();
  await page.screenshot({ path: info.outputPath("vault-id-link-after-move.png"), fullPage:true });
});

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

test("retired notes links redirect while retaining document IDs and creation intent", async ({ page }) => {
  await page.goto("/knowledge/notes?tab=today&date=2026-10-01");
  await expect(page).toHaveURL(/\/knowledge\/vault$/);
  await expect(page.getByRole("heading", { name: "문서 보관함", exact: true }).first()).toBeVisible();
  await expect(page.locator('.unified-nav a[href="/knowledge/notes"]')).toHaveCount(0);
  await expect(page.locator(".breadcrumbs")).toContainText("문서 보관함");
  await page.goto("/knowledge/notes?document=demo-packaging");
  await expect(page).toHaveURL(/\/knowledge\/vault\?document=demo-packaging$/);
  await expect(page.locator(".document-reader h1")).toHaveText("패키징 원칙");
  await page.goto("/knowledge/notes?new=1&tab=all");
  await expect(page).toHaveURL(/\/knowledge\/vault\?new=1$/);
  await expect(page.getByRole("textbox", { name: "새 페이지 제목", exact: true })).toBeVisible();
});

test("menu settings migrate legacy notes selection without opening unrelated menus", async ({ page }) => {
  await page.goto("/settings/access");
  await page.evaluate(() => localStorage.setItem("brandy-os-demo-menu-access-v1", JSON.stringify([
    { member_id: "demo-marketer", allowed_menus: ["/home", "/knowledge/notes"], version: 2 },
  ])));
  await page.reload();
  await page.getByRole("button", { name: "가상 마케터 권한 설정", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const knowledge = dialog.getByRole("group", { name: /^회사 문서/ });
  await expect(knowledge.getByRole("checkbox", { name: "내 노트", exact: true })).toHaveCount(0);
  await expect(knowledge.getByRole("checkbox", { name: "문서 보관함", exact: true })).toBeChecked();
  await expect(knowledge.getByRole("checkbox", { name: "회사 정본", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("brandy-os-demo-menu-access-v1")!)[0].allowed_menus))
    .toEqual(["/home", "/knowledge/vault"]);
});

test("existing inbox remains recoverable as a private document, without duplicating it", async ({ page }) => {
  await page.goto("/knowledge/docs");
  await expect(page.locator(".kw-table")).toBeVisible();
  await page.getByRole("button", { name: /^빠른 메모/ }).click();
  await page.getByRole("textbox", { name: "메모", exact: true }).fill("QA 개인 메모 기준");
  await page.getByRole("button", { name: "메모 저장", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue("QA 개인 메모 기준");
  const documentUrl = page.url();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("brandyos:knowledge:v1:"))!;
    const state = JSON.parse(localStorage.getItem(key)!);
    const owner = state.documents.find((row: { title: string }) => row.title === "QA 개인 메모 기준").owner_id;
    state.inbox.push({ id: "qa-pending-memo", owner_id: owner, body: "QA 보존할 미정리 메모", created_at: new Date().toISOString(), processed_at: null });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole("button", { name: /^빠른 메모/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "저장할 곳" })).toHaveValue("document");
  await expect(dialog.locator("option").filter({ hasText: /인박스|오늘 노트/ })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "이전 미정리 메모" })).toContainText("QA 보존할 미정리 메모");
  await dialog.getByRole("button", { name: "문서로 보관", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "editable markdown" })).toContainText("QA 보존할 미정리 메모");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "editable markdown" })).toContainText("QA 보존할 미정리 메모");
  await page.getByRole("button", { name: /^빠른 메모/ }).click();
  await expect(page.getByRole("region", { name: "이전 미정리 메모" })).toHaveCount(0);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.goto(documentUrl);
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue("QA 개인 메모 기준");
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("brandyos:knowledge:v1:"))!;
    const state = JSON.parse(localStorage.getItem(key)!);
    return state.documents.filter((row: { content_md: string }) => row.content_md === "QA 보존할 미정리 메모").map((row: { status: string }) => row.status);
  });
  expect(stored).toEqual(["draft"]);
});

test("document duplication and list navigation survive notes removal", async ({ page }) => {
  await page.goto("/knowledge/doc/example-team-document");
  await page.getByRole("button", { name: "개인 문서로 복제", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue("프로젝트 시작 가이드 사본");
  await expect(page.locator(".kw-editor-card .kw-badge").first()).toContainText("개인 문서");
  await expect(page.getByRole("link", { name: "문서 목록", exact: true })).toHaveAttribute("href", "/knowledge/vault");
  await page.getByRole("link", { name: "문서 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/vault$/);
  await expect(page.locator(".vault-workspace")).toBeVisible();
});

test("shared quick memo still appends to an active meeting", async ({ page }) => {
  await page.goto("/knowledge/meetings");
  await page.getByRole("button", { name: "새 회의", exact: true }).click();
  await page.getByRole("textbox", { name: "제목", exact: true }).fill("QA 메모 연결 회의");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.getByRole("button", { name: "회의 시작", exact: true }).click();
  await page.getByRole("button", { name: /^빠른 메모/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "저장할 곳" }).selectOption({ label: "QA 메모 연결 회의 · 팀 공개" });
  await dialog.getByRole("textbox", { name: "메모", exact: true }).fill("QA 공유 회의 메모");
  await dialog.getByRole("button", { name: "메모 저장", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("group", { name: "회의 메모", exact: true }).getByRole("textbox")).toContainText("QA 공유 회의 메모");
});

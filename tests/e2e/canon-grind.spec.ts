import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Requires the isolated YouTube-process demo.");
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

test("스레드 정본 다듬기: the 시험 묶음, a 글타래 scored on the 정본 §7 관문 beside the draft, and the next draft without scrolling back", async ({ page }) => {
  await page.goto("/content/threads-canon");
  await expect(page.getByRole("heading", { name: "스레드 정본 다듬기" })).toBeVisible();
  await expect(page.getByText("지금 정본: 쓰레드 자동화 운영 정본 — 안저 · Aside × OS v5.9")).toBeVisible();
  await page.locator(".yp-grind-cell").first().click();
  const dialog = page.getByRole("dialog", { name: "평가표" });
  await expect(dialog.getByText(/^본문 · \d+자$/)).toBeVisible();
  for (const name of ["주제", "첫 줄과 본문", "관점의 답", "적용", "근거 · 의미", "읽기 · 형식"]) await expect(dialog.getByRole("radiogroup", { name, exact: true })).toBeVisible();
  for (const [index, grade] of ["상", "상", "상", "중", "상", "상"].entries()) await dialog.getByRole("radiogroup").nth(index).getByRole("radio", { name: grade }).click();
  await dialog.getByLabel("적용 이유").fill("예시 이유");
  await dialog.getByRole("button", { name: "저장하고 다음 글타래" }).click();
  await expect(dialog.getByText("2 / 2")).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByText(/채점 1\/2/)).toBeVisible();
  await expect(page.getByRole("link", { name: "정본 다듬기" }).last()).toHaveAttribute("href", "/content/threads-canon");
});

test("SEO 칼럼 정본 다듬기: the column page and its image prompts beside the 평가표, under the 롱폼 menu", async ({ page }) => {
  await page.goto("/content/column-canon");
  await expect(page.getByRole("heading", { name: "SEO 칼럼 정본 다듬기" })).toBeVisible();
  await expect(page.getByText("지금 정본: SEO 칼럼 만드는 절차 (정본) doc v2")).toBeVisible();
  // 대표 decision 2026-10-31: the person who uploads the column scores it and proposes the 정본 change.
  await expect(page.getByText("칼럼을 올리는 작업자가 OS의 SEO 칼럼 만드는 절차 (정본)에 변경 제안을 보내요.", { exact: false })).toBeVisible();
  await page.locator(".yp-grind-cell").first().click();
  const dialog = page.getByRole("dialog", { name: "평가표" });
  await expect(dialog.frameLocator("iframe.yp-grind-col").getByRole("heading", { level: 1 })).toContainText("연봉 보고 옮겼는데 또 힘들다면");
  await dialog.getByText("검색 정보 · 이미지 프롬프트").click();
  await expect(dialog.getByText("salary-move-still-tired")).toBeVisible();
  for (const name of ["검색 질문에 바로 답하나", "검색되는 말인가", "원고에 충실한가 · 근거", "읽는 글인가", "AI가 인용하기 좋은가", "이미지 · FAQ"]) await expect(dialog.getByRole("radiogroup", { name, exact: true })).toBeVisible();
  for (let index = 0; index < 6; index++) await dialog.getByRole("radiogroup").nth(index).getByRole("radio", { name: "상" }).click();
  await dialog.getByRole("button", { name: "저장하고 다음 칼럼" }).click();
  await expect(dialog.getByText("2 / 2")).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  // The page opens its own group: 롱폼 유튜브 in the breadcrumb, the group unfolded.
  await expect(page.getByRole("navigation", { name: "현재 위치" }).getByRole("link", { name: "롱폼 유튜브" })).toBeVisible();
  await expect(page.getByRole("link", { name: "칼럼 정본 다듬기" })).toHaveAttribute("href", "/content/column-canon");
});

test("롱폼 원고 정본 다듬기: 두 번째 검수 by 정본 묶음, the gate turned back twice as a 정본 문제, under the 롱폼 menu", async ({ page }) => {
  await page.goto("/content/script-canon");
  await expect(page.getByRole("heading", { name: "롱폼 원고 정본 다듬기" })).toBeVisible();
  await expect(page.getByText("지금 정본: 원고 공정 정본 v2.5")).toBeVisible();
  await expect(page.getByText("정본 묶음 v2.5", { exact: true })).toBeVisible();
  await expect(page.getByText("원고 2 · 통과 0 · 판단 보류 2건")).toBeVisible();
  await expect(page.getByText("관문 5 사실과 재료 0/2")).toBeVisible();
  await expect(page.getByText("원고 2편에서 반려 · 정본 문제")).toBeVisible();
  await expect(page.getByRole("link", { name: "[예시] 연봉 보고 옮겼는데 또 힘들다면" })).toHaveAttribute("href", /\/content\/plan\?project=demo-1&view=outline/);
  await expect(page.getByRole("navigation", { name: "현재 위치" }).getByRole("link", { name: "롱폼 유튜브" })).toBeVisible();
  await expect(page.getByRole("link", { name: "원고 정본 다듬기" })).toHaveAttribute("href", "/content/script-canon");
});

test("카드 정본 실험 지시는 포맷별로 분리되고 다시 불러올 수 있다", async ({ page }) => {
  await page.goto("/content/card-canon");
  const list = page.getByRole("group", { name: "정리형 실험 프롬프트" });
  await list.getByLabel("스타일 지시").fill("현장의 질문으로 시작");
  await page.getByRole("checkbox", { name: "비교형", exact: true }).check();
  const compare = page.getByRole("group", { name: "비교형 실험 프롬프트" });
  await compare.getByLabel("품질 기준").fill("같은 기준으로 양쪽 비교");
  await page.getByRole("button", { name: "내 설정 저장" }).click();
  await page.reload();
  await page.getByRole("button", { name: "내 설정 불러오기" }).click();
  await expect(compare.getByLabel("품질 기준")).toHaveValue("같은 기준으로 양쪽 비교");
  await expect(list.getByLabel("스타일 지시")).toHaveValue("현장의 질문으로 시작");
  await expect(list.getByLabel("품질 기준")).toHaveValue("");
});

test("제작 정본 현황에서 시험 버전 차이와 상품 사실 작성 경로를 확인한다", async ({ page }) => {
  await page.goto("/content/canon");
  await expect(page.getByRole("heading", { name: "제작 정본 현황" })).toBeVisible();
  await expect(page.getByRole("row", { name: /롱폼 원고/ })).toContainText("판단 보류 2건");
  await page.getByRole("link", { name: "상품 사실 양식으로 작성" }).click();
  await expect(page.getByRole("textbox", { name: "새 페이지 제목" })).toHaveValue("상품 사실 정본");
});

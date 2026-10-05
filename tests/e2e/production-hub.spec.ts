import { expect, test } from "@playwright/test";
import { RETIRED_ROUTES } from "../../lib/final-routes";
test("retired UI routes go home without changing underlying APIs", async ({ page }) => {
  for (const [old, label] of Object.entries(RETIRED_ROUTES)) {
    await page.goto(old);
    await expect(page).toHaveURL(url => url.pathname === "/home" && url.searchParams.get("moved") === label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/확인할 일 \d+건/);
  }
});
test("one selected video remains across the seven process screens and reload", async ({ page }) => {
  await page.goto("/content/topics");
  await page.getByRole("combobox", { name: "작업 중인 영상 선택" }).selectOption("demo-final-topic");
  for (const name of ["원고·스크립트", "제목·썸네일", "숏폼 편집", "발행·업로드", "유튜브 관리", "영상 성과"]) {
    await page.getByRole("navigation", { name: "콘텐츠 공정 순서" }).getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page).toHaveURL(/topic=demo-final-topic/);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "작업 중인 영상 선택" })).toHaveValue("demo-final-topic");
  }
  await page.goto("/content/packages?topic=missing");
  await expect(page.getByText("이 영상은 접근할 수 없거나 우리 콘텐츠가 아닙니다.", { exact: true })).toBeVisible();
});
test("merged tabs and legacy tools retain their destination", async ({ page }) => {
  await page.goto("/organization/leave");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("일정·휴가");
  await expect(page.getByText("잔여 연차 중앙값", { exact: true })).toBeVisible();
  await page.goto("/home/decisions");
  await expect(page.getByRole("navigation", { name: "결정 출처" })).toBeVisible();
  await page.goto("/content/scripts");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("원고·스크립트");
  await expect(page.getByRole("button", { name: "새 원고 작성", exact: true }).first()).toBeVisible();
  await page.goto("/settings/company");
  await expect(page.getByRole("heading", { name: "외부 관리자 바로가기", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

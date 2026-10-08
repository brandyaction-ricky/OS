import { expect, test } from "@playwright/test";

// Run against an isolated, credential-free HR demo server only.
test.skip(process.env.HR_E2E_DEMO !== "true", "Requires an explicitly selected HR demo server");
test.beforeEach(async ({ page }) => {
  await page.goto("/hr/leave");
  await expect(page.getByText(/인사 체험 모드 · 가상 자료/)).toBeVisible();
});

test("approval, cancellation and manual adjustment update the same balance", async ({ page }) => {
  const row = page.getByRole("row").filter({ hasText: "직원 A" });
  await row.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("14일");
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await row.getByRole("button", { name: "상세", exact: true }).click();
  await page.getByRole("button", { name: "휴가 취소", exact: true }).click();
  await page.getByRole("button", { name: "취소 확인", exact: true }).click();
  await expect(row).toContainText("취소");
  await page.getByRole("navigation", { name: "인사·노무 메뉴" }).getByRole("link", { name: "연차 관리", exact: true }).click();
  await expect(row).toContainText("16일");
  await row.getByRole("button", { name: "원장 보기" }).click();
  await page.getByRole("button", { name: "＋ 수동 조정" }).click();
  await page.getByRole("spinbutton", { name: /조정 일수/ }).fill("-0.5");
  await page.getByRole("textbox", { name: "사유", exact: true }).fill("가상 QA 조정");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect(row).toContainText("15.5일");
});

test("calendar switches between bounded month and week views and filters people", async ({ page }) => {
  await page.getByRole("link", { name: "휴가 캘린더", exact: true }).click();
  await expect(page.getByRole("region", { name: "월간 휴가 캘린더" }).locator("time")).toHaveCount(42);
  await page.getByRole("button", { name: "주", exact: true }).click();
  await expect(page.getByRole("region", { name: "주간 휴가 캘린더" }).locator("time")).toHaveCount(7);
  await expect(page.getByRole("region", { name: "주간 휴가 캘린더" })).toContainText("쉬는 날");
  await page.getByRole("combobox", { name: "캘린더 사람" }).selectOption({ label: "직원 A" });
  await expect(page.getByRole("button", { name: "직원 D · 오전 반차" })).toHaveCount(0);
});

test("mobile drawer has no page overflow and Escape restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const open = page.getByRole("button", { name: "＋ 휴가 입력", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "입력 창 닫기" }).press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test("rejection requires a reason and a new holiday blocks approval", async ({ page }) => {
  const row = page.getByRole("row").filter({ hasText: "직원 A" });
  await row.getByRole("button", { name: "확인", exact: true }).click();
  await page.getByRole("button", { name: "반려", exact: true }).click();
  await expect(page.getByRole("button", { name: "반려 확인" })).toBeDisabled();
  await page.getByRole("textbox", { name: "반려 사유", exact: true }).fill("가상 일정 변경");
  await page.getByRole("button", { name: "반려 확인" }).click();
  await expect(row).toContainText("반려");
  const nav = page.getByRole("navigation", { name: "인사·노무 메뉴" });
  await nav.getByRole("link", { name: "연차 관리", exact: true }).click();
  await page.getByRole("link", { name: "부여 규칙·공휴일" }).click();
  await page.getByRole("textbox", { name: "날짜", exact: true }).fill("2026-10-14");
  await page.getByRole("textbox", { name: "휴일 이름", exact: true }).fill("가상 휴일");
  await page.getByRole("button", { name: "＋ 휴일 등록" }).click();
  await expect(page.getByRole("row").filter({ hasText: "2026-10-14" })).toContainText("가상 휴일");
  await nav.getByRole("link", { name: "휴가·일정", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "직원 C" }).getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "승인", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("고른 날이 모두 쉬는 날입니다");
});

test("document completion, contract replacement and retirement preserve previous records", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "인사·노무 메뉴" });
  await nav.getByRole("link", { name: "서류·계약", exact: true }).click();
  await page.getByRole("button", { name: "직원 A 근로계약서 교부 처리", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "직원 A 근로계약서 교부 처리" })).toContainText("완료");
  await page.getByRole("link", { name: "직원 A", exact: true }).click();
  await page.getByRole("link", { name: "근로 조건", exact: true }).click();
  await page.getByRole("button", { name: "근로 조건 변경", exact: true }).click();
  await page.getByRole("textbox", { name: "근무 장소", exact: true }).fill("가상 사무실");
  await page.getByRole("textbox", { name: "바꾼 이유", exact: true }).fill("가상 계약 갱신");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "최초 등록" })).toContainText("지난 계약");
  await page.getByRole("link", { name: "서류", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "근로계약서 교부" })).toContainText("빠짐");
  await page.getByRole("button", { name: "퇴사 처리", exact: true }).click();
  await page.getByRole("textbox", { name: "퇴사일 마지막 근무일", exact: true }).fill("2026-10-08");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await nav.getByRole("link", { name: "서류·계약", exact: true }).click();
  await page.getByRole("link", { name: "퇴사자 보존", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "직원 A" })).toContainText("2029-10-08");
  await expect(page.getByRole("row").filter({ hasText: "직원 A" })).toContainText("자진 퇴사");
});

test("a synthetic form upload keeps the previous file in version history", async ({ page }) => {
  const file = { name: "qa.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=", "base64") };
  await page.getByRole("navigation", { name: "인사·노무 메뉴" }).getByRole("link", { name: "서류·계약", exact: true }).click();
  await page.getByRole("link", { name: "양식 보관함", exact: true }).click();
  await page.getByRole("button", { name: "＋ 양식 올리기", exact: true }).click();
  await page.getByRole("textbox", { name: "양식 이름", exact: true }).fill("가상 QA 양식");
  await page.getByRole("textbox", { name: "버전", exact: true }).fill("v1.0");
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "가상 QA 양식" });
  await expect(row).toContainText("v1.0");
  await row.getByRole("button", { name: "새 버전 올리기" }).click();
  await page.getByRole("textbox", { name: "버전", exact: true }).fill("v2.0");
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ ...file, name:"qa-v2.png" });
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect(row).toContainText("v2.0");
  await row.getByRole("button", { name: "버전 이력" }).click();
  await expect(page.getByRole("dialog")).toContainText("이전 파일 · v1.0");
});

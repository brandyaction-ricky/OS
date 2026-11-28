import { expect, test, type Page } from "@playwright/test";

// 유튜브 공정 v1 (T1): menu, 대표 메뉴 and the seven screens. Runs only with YOUTUBE_V1_ENABLED=true.
async function openApprovalQueue(page: Page) {
  const nav = page.locator("#main-navigation");
  const group = nav.getByRole("button", { name: /^대표 메뉴/ });
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  await nav.getByRole("link", { name: "컨펌", exact: true }).click();
  await page.getByRole("tab", { name: /컨펌 대기/ }).click();
}

test.describe("유튜브 공정 v1 smoke", () => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Only runs when the YouTube process v1 flag is enabled.");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
  });

  test("the shared and longform menus open their workspaces and the approval queue", async ({ page }) => {
    await page.goto("/content/projects");
    const nav = page.locator("#main-navigation");
    const common = nav.getByRole("button", { name: /^공통/ });
    if (await common.getAttribute("aria-expanded") !== "true") await common.click();
    await nav.getByRole("link", { name: "스케줄", exact: true }).click();
    await expect(page.getByRole("heading", { name: "콘텐츠 일정", level: 1 })).toBeVisible();
    const longform = nav.getByRole("button", { name: /^롱폼 유튜브/ });
    if (await longform.getAttribute("aria-expanded") !== "true") await longform.click();
    await nav.getByRole("link", { name: "내 롱폼 영상" }).click();
    await expect(page).toHaveURL(/platform=longform/);
    await page.getByRole("link", { name: /컨펌하러 가기/ }).click();
    await expect(page.getByRole("heading", { name: "컨펌", level: 1 })).toBeVisible();
    await expect(page.locator(".breadcrumbs")).toContainText("대표 메뉴");
  });

  test("a three-line topic creates three videos for the selected approver", async ({ page }) => {
    await page.goto("/content/projects");
    await page.getByRole("button", { name: "새 영상 만들기" }).click();
    const lines = ["[시험] 첫 번째 주제", "[시험] 두 번째 주제", "[시험] 세 번째 주제"];
    await page.getByLabel("새 영상 주제").fill(lines[0]);
    await page.getByRole("button", { name: "시작하기" }).click();
    const topic = page.getByRole("textbox", { name: "주제", exact: true });
    await expect(topic).toHaveValue(lines[0]);
    await topic.fill(lines.join("\n"));
    await page.getByLabel("롱폼 애니메이션").check();
    await page.getByRole("textbox", { name: "정밀 타겟" }).fill("퇴근 후 무엇부터 할지 막힌 직장인");
    const ask = page.getByRole("button", { name: "컨펌 요청하기" });
    await ask.click();
    await page.getByRole("button", { name: "요청 보내기" }).click();
    await expect(page.locator(".yp-cwait")).toContainText("주제 컨펌 대기");
    await expect(page.getByText(/영상 2개를 더 만들어/)).toBeVisible();
    await openApprovalQueue(page);
    for (const line of lines) await expect(page.getByRole("button").filter({ hasText: line })).toBeVisible();
  });

  test("the PD can edit after a review, and an unchanged re-request requires a reply before approval", async ({ page }) => {
    await page.goto("/content/plan?project=demo-p8&view=topic");
    await expect(page.getByRole("textbox", { name: "주제", exact: true })).toBeEditable();
    await page.locator(".yp-cwait").getByRole("button", { name: "수정 요청" }).click();
    await page.locator(".yp-confirm-fields").getByLabel("정밀 타겟").check();
    await page.getByLabel("메모 (필수)").fill("타겟을 더 좁혀 주세요");
    await page.getByRole("button", { name: "수정 요청 보내기" }).click();
    await expect(page.getByRole("textbox", { name: "정밀 타겟" })).toBeEditable();
    await expect(page.getByRole("textbox", { name: "주제", exact: true })).toBeEditable();
    await page.getByRole("button", { name: "컨펌 요청하기" }).click();
    await page.getByRole("button", { name: "요청 보내기" }).click();
    const send = page.getByRole("button", { name: "이유와 함께 다시 요청" });
    await expect(send).toBeDisabled();
    await page.getByLabel("고친 칸 없이 다시 요청하는 이유").fill("지금 타겟이 맞다고 봐요");
    await send.click();
    await expect(page.locator(".yp-cwait")).toContainText("지금 타겟이 맞다고 봐요");
    await openApprovalQueue(page);
    await page.getByRole("button", { name: /구독자 1만 명/ }).click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await page.getByRole("tab", { name: /내가 처리한 것/ }).click();
    await page.getByRole("button", { name: /구독자 1만 명/ }).click();
    await expect(page.getByRole("button", { name: "결정 되돌리기" })).toBeVisible();
  });

  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    test(`${width}px ${theme} keeps every v1 screen within the viewport`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const [name, url, heading] of [
        ["projects", "/content/projects", "내 영상"],
        ["plan", "/content/plan?project=demo-p1&view=topic", "주제"],
        ["make", "/content/make?project=demo-p5", "제작"],
        ["final-check", "/content/final-check?project=demo-p6&tab=video", "최종 검토"],
        ["upload", "/content/upload?project=demo-p7", "업로드"],
        ["schedule", "/content/schedule?mode=month", "콘텐츠 일정"],
        ["confirm", "/content/confirm?tab=wait", "컨펌"],
      ] as const) {
        await page.goto(url);
        await expect(page.locator("section.yp.ui-v2")).toBeVisible();
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}px ${theme}`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${theme}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
});

import { expect, test } from "@playwright/test";

// 유튜브 공정 v1 (T1): menu, 대표 메뉴 and the seven screens. Runs only with YOUTUBE_V1_ENABLED=true.
test.describe("유튜브 공정 v1 smoke", () => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Only runs when the YouTube process v1 flag is enabled.");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
  });

  test("the YouTube menu becomes the v1 pages with 대표 메뉴 on top, and existing screens still open", async ({ page }) => {
    await page.goto("/content/projects");
    await expect(page.locator("#nav-content a.page-link")).toHaveText(["프로젝트", "기획", "제작", "최종 검수", "업로드", "쇼츠", "스케줄"]);
    await expect(page.locator("#nav-ceo a.page-link")).toHaveText(["컨펌"]);
    await page.getByRole("navigation", { name: "기존 화면" }).getByRole("link", { name: "3. 영상 제작" }).click();
    await expect(page).toHaveURL(/\/content\/video$/);
    await expect(page.getByRole("heading", { name: "영상 제작", level: 1 })).toBeVisible();
    await page.goto("/content/confirm");
    await expect(page.locator(".breadcrumbs")).toContainText("대표 메뉴");
  });

  test("a three-line topic becomes three projects waiting for the confirm (수용 2 · 3)", async ({ page }) => {
    await page.goto("/content/projects");
    await page.getByRole("link", { name: "새 프로젝트" }).click();
    await expect(page).toHaveURL(/project=new&view=topic/);
    const request = page.locator(".yp-fl-act button.yp-btn");
    await expect(request).toBeDisabled();
    await expect(page.locator(".yp-fl-hint")).toHaveText("주제를 써주세요");
    const lines = ["[시험] 첫 번째 주제", "[시험] 두 번째 주제", "[시험] 세 번째 주제"];
    await page.getByLabel("주제", { exact: true }).fill(lines.join("\n"));
    await expect(page.locator(".yp-fl-hint")).toHaveText("유형을 골라주세요");
    await expect(request).toContainText("주제 컨펌 요청 (3개)");
    await page.getByLabel("롱폼 애니메이션").check();
    await page.getByLabel("정밀 타겟").fill("퇴근 후 무엇부터 할지 막힌 직장인");
    await expect(request).toBeEnabled();
    await request.click();
    await expect(page.locator(".yp-fl-status")).toContainText("대표 컨펌 대기");
    await expect(page.getByText("2개를 더 만들고")).toBeVisible();
    await expect(page.getByLabel("주제", { exact: true })).toHaveAttribute("readonly", "");
    await page.locator("#nav-content").getByRole("link", { name: "프로젝트", exact: true }).click();
    await expect(page).toHaveURL(/\/content\/projects$/);
    for (const line of lines) {
      const row = page.locator(".yp-plist tr", { hasText: line });
      await expect(row).toHaveCount(1);
      await expect(row.locator(".yp-tag", { hasText: "컨펌 대기" })).toBeVisible();
    }
  });

  test("수정 요청 opens only the ticked fields; an unchanged re-request needs a reason; OK moves to 처리한 것 (수용 4 · 6)", async ({ page }) => {
    await page.goto("/content/plan?project=demo-p8&view=topic");
    // 수용 4: while the confirm waits, every field is read-only.
    await expect(page.getByLabel("주제", { exact: true })).toHaveAttribute("readonly", "");
    await page.locator(".yp-cwait").getByRole("button", { name: "수정 요청" }).click();
    await page.locator(".yp-confirm-fields").getByLabel("주제", { exact: true }).check();
    await page.locator(".yp-confirm-fields").getByLabel("정밀 타겟").check();
    await page.locator("#yp-confirm-memo").fill("타겟을 더 좁혀 주세요");
    await page.getByRole("button", { name: "수정 요청 보내기" }).click();
    await expect(page.getByText("대표 수정 요청")).toBeVisible();
    await expect(page.locator("#yp-topic-title")).not.toHaveAttribute("readonly", "");
    await expect(page.locator("#yp-topic-target")).not.toHaveAttribute("readonly", "");
    await expect(page.locator("#yp-topic-note")).toHaveAttribute("readonly", "");
    await expect(page.getByLabel("롱폼 애니메이션")).toBeDisabled();
    await page.locator(".yp-fl-act button.yp-btn").click();
    await expect(page.locator("#yp-topic-reply")).toBeVisible();
    await page.locator("#yp-topic-reply").fill("지금 타겟이 맞다고 봐요");
    await page.getByRole("button", { name: "이유와 함께 다시 요청" }).click();
    await expect(page.locator(".yp-fl-status")).toContainText("대표 컨펌 대기");
    await expect(page.getByText("PD 답글")).toBeVisible();
    await page.locator("#nav-ceo").getByRole("link", { name: "컨펌" }).click();
    await page.locator(".yp-ci", { hasText: "구독자 1만 명" }).click();
    await page.locator(".yp-cv").getByRole("button", { name: "OK" }).click();
    await page.getByRole("tab", { name: /내가 처리한 것/ }).click();
    await page.locator(".yp-ci", { hasText: "구독자 1만 명" }).click();
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
        ["projects", "/content/projects", "프로젝트"],
        ["plan", "/content/plan?project=demo-p1&view=topic", "기획"],
        ["make", "/content/make?project=demo", "제작"],
        ["final-check", "/content/final-check?project=demo&tab=video", "최종 검수"],
        ["upload", "/content/upload?project=demo", "업로드"],
        ["schedule", "/content/schedule?mode=month", "스케줄"],
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

import { expect, test, type Page } from "@playwright/test";

const observations = new WeakMap<Page, { forbidden: string[]; errors: string[] }>();

// Synthetic browser workflow only. No model quality or server authorization claim.
test.beforeEach(async ({ page, baseURL }) => {
  const forbidden: string[] = [];
  const errors: string[] = [];
  observations.set(page, { forbidden, errors });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin || url.pathname.startsWith("/api/")) {
      forbidden.push(`${url.origin}${url.pathname}`);
      await route.abort();
    } else await route.continue();
  });
  await page.goto("/system-one");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("공통 판단");
});

test.afterEach(async ({ page }) => {
  // Assert across the whole interaction, not only the initial page load.
  const { forbidden, errors } = observations.get(page)!;
  expect(forbidden, "sandbox must not issue API or external requests").toEqual([]);
  expect(errors, "sandbox must not raise browser errors").toEqual([]);
});

test("separate human decisions, duplicate reuse, version change and access withdrawal", async ({ page }) => {
  const run = page.getByRole("button", { name: "모의 검토 실행", exact: true });
  await run.click();
  await expect(page.getByTestId("mock-verdict")).toHaveText("채택");
  await run.click();
  await expect(page.getByTestId("mock-run-count")).toHaveText("1");
  await page.getByLabel("사람 판정", { exact: true }).selectOption("revise");
  await page.getByLabel("결정 이유", { exact: true }).fill("조건 설명을 더 명확히 하는 모의 결정");
  await page.getByRole("button", { name: "화면에 결정 기록", exact: true }).click();
  await expect(page.getByTestId("human-decisions")).toContainText("조건 설명을 더 명확히");
  await expect(page.getByTestId("mock-verdict")).toHaveText("채택");

  await page.getByText("변경·접근 취소 시험", { exact: true }).click();
  await page.getByRole("button", { name: "원문 버전 변경", exact: true }).click();
  await expect(page.getByTestId("mock-stale")).toBeVisible();
  await expect(page.getByRole("button", { name: "화면에 결정 기록", exact: true })).toBeDisabled();
  await run.click();
  await expect(page.getByTestId("mock-run-count")).toHaveText("2");
  await expect(page.getByTestId("human-decisions")).not.toContainText("조건 설명을 더 명확히");
  await page.getByRole("button", { name: "접근 취소 시험", exact: true }).click();
  await expect(page.getByTestId("mock-unavailable")).toBeVisible();
  await expect(page.getByRole("region", { name: "판단 카드", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("human-decisions")).toHaveCount(0);
  await expect(page.getByText("합성 기획안 · 정보형 시험 자료", { exact: true })).toHaveCount(0);
});

test("missing evidence retains known revisions without an automatic retry", async ({ page }) => {
  await page.getByLabel("시험 사례", { exact: true }).selectOption("missing_revision");
  await page.getByRole("button", { name: "모의 검토 실행", exact: true }).click();
  await expect(page.getByTestId("mock-verdict")).toHaveText("보류");
  const card = page.getByRole("region", { name: "판단 카드", exact: true });
  await expect(card).toContainText("자료가 없다는 뜻은 아닙니다");
  await expect(card).toContainText("콘텐츠 역할과 CTA");
  await expect(page.getByTestId("mock-run-count")).toHaveText("1");
});

test("revision, conflict and forbidden action remain distinct", async ({ page }) => {
  for (const [scenario, verdict] of [["revise", "수정"], ["conflict", "사람 검토"], ["forbidden", "차단"]]) {
    await page.getByLabel("시험 사례", { exact: true }).selectOption(scenario);
    await page.getByRole("button", { name: "모의 검토 실행", exact: true }).click();
    await expect(page.getByTestId("mock-verdict")).toHaveText(verdict);
  }
});

test("metadata and execution failures never produce quality verdicts", async ({ page }) => {
  for (const scenario of ["metadata", "timeout", "invalid_output", "budget"]) {
    await page.getByLabel("시험 사례", { exact: true }).selectOption(scenario);
    await page.getByRole("button", { name: "모의 검토 실행", exact: true }).click();
    await expect(page.getByRole("region", { name: "검토 결과", exact: true }).getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("mock-verdict")).toHaveCount(0);
  }
});

test("document instructions cannot publish and criterion changes require fresh review", async ({ page }) => {
  await page.getByLabel("시험 사례", { exact: true }).selectOption("injection");
  await page.getByRole("button", { name: "모의 검토 실행", exact: true }).click();
  await expect(page.getByTestId("mock-verdict")).toHaveText("채택");
  await page.getByText("변경·접근 취소 시험", { exact: true }).click();
  await page.getByRole("button", { name: "기준 버전 변경", exact: true }).click();
  await expect(page.getByTestId("mock-stale")).toBeVisible();
  await expect(page.getByRole("button", { name: "화면에 결정 기록", exact: true })).toBeDisabled();
});

test("desktop and mobile cards stay readable, and refresh clears local decisions", async ({ page }, testInfo) => {
  await page.getByLabel("시험 사례", { exact: true }).selectOption("missing_revision");
  await page.getByRole("button", { name: "모의 검토 실행", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("system-one-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("mock-verdict")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("system-one-mobile.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("mock-verdict")).toHaveCount(0);
});

test("OS shared skin supports both themes and keyboard focus without horizontal overflow", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    const appearance = await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>(".primary-button")!;
      const panel = document.querySelector<HTMLElement>(".panel")!;
      const sample = document.createElement("div");
      sample.style.backgroundColor = "var(--accent)";
      document.body.append(sample);
      const accent = getComputedStyle(sample).backgroundColor;
      sample.style.backgroundColor = "var(--panel-2)";
      const surface = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return { button: getComputedStyle(button).backgroundColor, accent,
        panel: getComputedStyle(panel).backgroundColor, surface,
        title: getComputedStyle(document.querySelector("h1")!).fontSize };
    });
    expect(appearance.button).toBe(appearance.accent);
    expect(appearance.panel).toBe(appearance.surface);
    expect(appearance.title).toBe("22px");
    await page.getByLabel("시험 사례", { exact: true }).focus();
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
    await page.screenshot({ path: testInfo.outputPath(`os-tone-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});

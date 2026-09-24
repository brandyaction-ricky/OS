import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const width of [390, 1040]) {
  test(`pipeline preparation uses readable full-width fields at ${width}px`, async ({ page }) => {
    const styles = await readFile("app/globals.css", "utf8");
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>${styles}body{display:block;padding:16px}</style>
      <section class="automation-layout"><aside>주제</aside><div class="automation-detail">
      <section class="pipeline-panel"><header><p>제목·썸네일을 먼저 정하고 제작 자료를 준비합니다.</p></header>
      <form class="pipeline-inputs"><label>경험<textarea></textarea></label>
      <fieldset><legend>제작 자료 준비 방식</legend><p>칠판형 구성안과 촬영 진행표</p>
      <label>내용 구성안<textarea></textarea></label><label>촬영 진행표<textarea></textarea></label></fieldset></form>
      </section></div></section>`);
    await expect(page.locator('fieldset')).toHaveCSS('padding-left', '20px');
    await expect(page.locator('.pipeline-inputs')).toHaveCSS('row-gap', '20px');
    const bounds = await page.locator('fieldset').boundingBox();
    expect(bounds?.width).toBeGreaterThan(width - 110);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [390, 1280]) {
  test(`workflow card spacing stays readable at ${width}px`, async ({ page }) => {
    const styles = await readFile("components/content-planning-handoff.css", "utf8");
    await page.setViewportSize({ width, height: 900 });
    // Isolated layout fixture, not authenticated application coverage.
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:16px;font:14px sans-serif}
      :root{--line-soft:#ddd;--muted:#555}.panel-header{border-bottom:1px solid var(--line-soft)}
      ${styles}</style><section class="panel content-workflow-panel">
      <div class="panel-header"><h3>자료 확인</h3><p>승인 기능 아님</p></div>
      <div class="content-workflow-body"><p>현재 기획과 연결된 문서를 다시 확인합니다.</p>
      <button>자료 다시 확인</button><div role="status"><p>연결 문서 2개</p><ul>
      <li><a href="#">${"긴문서제목".repeat(40)}</a><p>연결 당시 v1 → 현재 v2</p></li>
      <li>현재 내용을 확인해 주세요.</li></ul></div>
      <p class="content-workflow-note">자료 조회는 승인이나 자동 실행을 뜻하지 않습니다.</p></div></section>`);
    const body = page.locator(".content-workflow-body");
    await expect(body).toHaveCSS("padding-left", width < 640 ? "18px" : "24px");
    await expect(body).toHaveCSS("row-gap", width < 640 ? "18px" : "20px");
    await expect(page.locator("li + li")).toHaveCSS("margin-top", "16px");
    await expect(page.locator(".content-workflow-note")).toHaveCSS("border-top-width", "1px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button").focus();
    await expect(page.getByRole("button")).toBeFocused();
  });
}

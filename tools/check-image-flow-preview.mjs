// Run against a local dev server started with IMAGE_AD_FLOW_PREVIEW_FILE.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3456";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const writes = [], errors = [], external = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (request.method() === "POST") writes.push(new URL(request.url()).pathname);
});
await page.route(/^https?:/, route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url()); return route.abort();
});
try {
  await page.goto(origin + "/content/images?view=tests");
  await expect(page.getByRole("navigation", {name:"현재 위치"})).toContainText("광고");
  await page.getByRole("button", {name: "새 테스트 프로젝트", exact: true}).click();
  const product=page.getByRole("combobox",{name:"상품 선택",exact:true});
  for(const id of ["myin-free","myin-core","myin-precision","myin-strength"])
    await expect(product.locator(`option[value="${id}"]`)).toHaveCount(1);
  for(const id of ["myin-free","myin-precision"]) {
    await product.selectOption(id);
    await expect(page.getByRole("button",{name:"소구점 선택하기",exact:true})).toBeEnabled();
    assert((await page.locator(".ic-copy-lines").innerText()).includes("제공 내용"));
  }
  await product.selectOption("myin-strength");
  await expect(page.getByRole("button",{name:"소구점 선택하기",exact:true})).toBeDisabled();
  await expect(page.getByText("상품 정보 확인 필요",{exact:false}).last()).toBeVisible();
  await page.locator("select").first().selectOption("myin-core");
  await page.getByLabel("프로젝트 이름 (선택)").fill("화면 기능 테스트");
  await page.getByRole("button", {name: "소구점 선택하기", exact: true}).click();
  const appeals = ["처음 시작해도 괜찮을까?", "나에게 맞는 선택은?", "시간을 어떻게 아낄까?", "무엇부터 알아보면 될까?", "어떤 차이가 있을까?"];
  await page.getByLabel("소구점 직접 작성").fill(appeals.join("\n"));
  await page.getByRole("button", {name: "레퍼런스 선택하기", exact: true}).click();
  await page.getByRole("button",{name:"소구점으로 돌아가기",exact:true}).click();
  await expect(page.getByLabel("소구점 직접 작성")).toHaveValue(appeals.join("\n"));
  await page.getByRole("button",{name:"뒤로 · 상품 선택",exact:true}).click();
  await expect(product).toHaveValue("myin-core");
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await expect(page.getByLabel("소구점 직접 작성")).toHaveValue(appeals.join("\n"));
  await page.getByRole("button", {name: "레퍼런스 선택하기", exact: true}).click();
  const next = page.getByRole("button", {name: "이 디자인으로 카피 5개 제안받기", exact: true});
  await expect(next).toBeDisabled();
  const cards = page.locator(".ic-flow-reference-card");
  await expect(cards).toHaveCount(18);
  await expect.poll(()=>cards.first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(250);
  for (const img of await cards.locator("img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveJSProperty("complete", true);
    await expect.poll(()=>img.evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
  }
  await page.locator('[data-reference-id="R01"] .ic-flow-reference-choice').click();
  await expect(page.getByText("이 원본은 현재 미리보기에서 제작할 수 없습니다.", {exact:false})).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByLabel("레퍼런스 검색", {exact:true}).fill("M01");
  await page.getByLabel("보여줄 레퍼런스", {exact:true}).selectOption("all");
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole("button").first()).toBeDisabled();
  await expect(cards).toContainText("원본 이미지 등록 필요");
  await page.getByLabel("보여줄 레퍼런스", {exact:true}).selectOption("ready");
  await page.getByLabel("레퍼런스 검색", {exact:true}).fill("");
  await expect(cards).toHaveCount(2);
  await page.locator('[data-reference-id="R02"] .ic-flow-reference-choice').click();
  await page.getByRole("button", {name: "크게 보기", exact: true}).first().click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("button", {name: "닫기", exact: true}).click();
  await next.click();
  await expect(page.getByRole("heading", {name: "카피 확인", exact: true})).toBeVisible();
  await expect(page.getByLabel("제목", {exact: true})).toHaveCount(5);
  const edited = "처음 시작할 때 필요한 것은?";
  await page.getByLabel("제목", {exact: true}).first().fill(edited);
  await page.getByRole("button", {name: "레퍼런스로 돌아가기", exact: true}).click();
  await expect(page.locator('.ic-flow-reference-choice[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('[data-reference-id="R15"] .ic-flow-reference-choice').click();
  await next.click();
  await expect(page.getByLabel("제목", {exact: true}).first()).toHaveValue(edited);
  await page.reload();
  await expect(page.getByLabel("제목", {exact: true}).first()).toHaveValue(edited);
  await expect(page.locator(".ic-preview-png")).toHaveCount(0);
  await page.getByRole("button", {name: "카피 확정 · 시안 보기", exact: true}).click();
  await expect(page.locator(".ic-preview-png")).toHaveCount(5, {timeout: 60_000});
  await page.getByRole("button",{name:"뒤로 · 카피 확인",exact:true}).click();
  await expect(page.getByRole("region",{name:"이전 단계 확인"})).toContainText(edited);
  await page.getByRole("button",{name:"뒤로 · 레퍼런스 확인",exact:true}).click();
  await expect(page.getByAltText("승인한 레퍼런스 원본")).toBeVisible();
  await page.getByRole("button",{name:"현재 시안으로 돌아가기",exact:true}).click();
  await expect(page.locator(".ic-preview-png")).toHaveCount(5, {timeout: 60_000});
  const confirm = page.getByRole("button", {name: "미리보기 확인 · 체험 출력", exact: true});
  await expect(confirm).toBeEnabled({timeout: 60_000});
  await confirm.click();
  await expect(page.getByRole("button", {name: "최종 검수 완료", exact: true})).toBeEnabled({timeout: 60_000});
  await page.getByRole("button", {name: "최종 검수 완료", exact: true}).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "내보내기", exact: true}).first().click();
  assert.match((await download).suggestedFilename(), /\.png$/);
  const projectUrl=page.url();
  await page.getByRole("button",{name:"프로젝트 삭제",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("화면 기능 테스트");
  await page.getByRole("button",{name:"휴지통으로 이동",exact:true}).click();
  await page.reload();
  await expect(page.getByRole("link",{name:/화면 기능 테스트/})).toHaveCount(0);
  await page.getByRole("button",{name:"휴지통",exact:true}).click();
  await page.getByRole("button",{name:"화면 기능 테스트 복구",exact:true}).click();
  await page.getByRole("button",{name:"작업으로 돌아가기",exact:true}).click();
  await page.goto(projectUrl);
  await expect(page.locator(".ic-preview-png")).toHaveCount(5,{timeout:60_000});
  await expect(page.getByText("최종 검수 완료",{exact:true})).toBeVisible();
  assert(writes.length >= 5 && writes.every(path => path === "/api/v1/content/image-creatives/demo/preview"));
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log("PASS: ad navigation, four product choices and missing-data gate, step back preservation, warehouse 18 originals, copy edit/reload, five PNGs, saved-stage navigation, final download, trash/reload/restore; no AI or external writes.");
} finally {
  await page.screenshot({path: "/private/tmp/os-image-flow-checked.png", fullPage: true});
  await browser.close();
}

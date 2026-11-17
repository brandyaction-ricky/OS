// Local review data stays outside Git. No provider credentials or live AI calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
const origin=process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3456";
assert(["127.0.0.1","localhost"].includes(new URL(origin).hostname));
const example=JSON.parse(fs.readFileSync(process.env.IMAGE_AD_FLOW_PREVIEW_FILE || ".local-review/review-data.json","utf8")).flow.promptEditExamples[0];
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const writes=[],errors=[],external=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>{if(r.method()==="POST")writes.push(new URL(r.url()).pathname);});
await page.route(/^https?:/,route=>{
  if(new URL(route.request().url()).origin===origin)return route.continue();
  external.push(route.request().url());return route.abort();
});
try {
  await page.goto(origin+"/content/images?view=tests");
  await page.getByRole("button",{name:"새 테스트 프로젝트",exact:true}).click();
  await page.getByRole("combobox",{name:"상품 선택",exact:true}).selectOption("myin-core");
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await page.getByLabel("소구점 직접 작성").fill("선택을 준비하는 방법");
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await page.locator(`[data-reference-id="${example.referenceId}"] .ic-flow-reference-choice`).click();
  await page.getByRole("button",{name:"이 디자인으로 카피 1개 제안받기",exact:true}).click();
  for(const [name,value] of Object.entries(example.sourceCopy)) {
    const field=page.getByLabel(({headline:"제목",body:"본문",cta:"버튼 문구"})[name],{exact:true});
    if(await field.count()) await field.fill(value);
  }
  await page.getByRole("button",{name:"카피 확정 · 시안 보기",exact:true}).click();
  const base=page.locator(".ic-preview-png").first();
  await expect(base).toBeVisible({timeout:60_000});
  const bytes=await base.evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
  const hash=createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  fs.writeFileSync(".local-review/prompt-edit-test-source.png",Buffer.from(bytes));
  assert.equal(hash,example.sourceSha256,"prepared example must match the actual OS source PNG");
  await page.getByRole("button",{name:"수정하기",exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"말로 수정하기",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"예시 문구 넣기",exact:true}).click();
  const request=page.getByRole("button",{name:"수정 예시 확인",exact:true});
  await expect(request).toBeEnabled({timeout:60_000});
  await request.click();
  await expect(page.getByAltText("AI 수정 후보")).toBeVisible();
  const apply=page.getByRole("button",{name:"수정본 적용",exact:true});
  await expect(apply).toBeEnabled();
  await page.getByLabel("수정 요청",{exact:true}).fill(example.prompt+" 추가 요청");
  await expect(apply).toBeDisabled();
  await page.getByLabel("수정 요청",{exact:true}).fill(example.prompt);
  await page.screenshot({path:"/private/tmp/os-image-prompt-comparison.png",fullPage:true});
  await apply.click();
  await expect(page.getByText("프롬프트 수정본",{exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"1번째 묶음 검토",exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText("프롬프트 수정본",{exact:true})).toBeVisible();
  const latest=page.getByRole("region",{name:"2번째 묶음 검토",exact:true});
  const confirm=latest.getByRole("button",{name:"미리보기 확인 · 체험 출력",exact:true});
  await expect(confirm).toBeEnabled({timeout:60_000});await confirm.click();
  await latest.getByRole("button",{name:"최종 검수 완료",exact:true}).click();
  const downloading=page.waitForEvent("download");
  await latest.getByRole("button",{name:"내보내기",exact:true}).click();
  const download=await downloading;
  assert.match(download.suggestedFilename(),/\.png$/);
  const output=await sharp(await download.path()).ensureAlpha().raw().toBuffer();
  const expected=await sharp("public"+example.image.url).ensureAlpha().raw().toBuffer();
  assert(output.equals(expected),"export must contain the edited pixels without old copy re-applied");
  assert(writes.every(path=>path==="/api/v1/content/image-creatives/demo/preview"));
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log("PASS: exact-source example, prompt comparison, changed-request guard, immutable revision, reload and final PNG export; no provider calls.");
} finally {
  await page.screenshot({path:"/private/tmp/os-image-prompt-last.png",fullPage:true});
  fs.writeFileSync(".local-review/prompt-edit-test-dom.txt",await page.locator("main").innerText());
  await browser.close();
}

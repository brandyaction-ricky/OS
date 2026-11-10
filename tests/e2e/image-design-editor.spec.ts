import { approveFormat, finishDemoBatch } from "./image-approval-steps";
import { test, expect, type Locator } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import JSZip from "jszip";
import { resolvePlacement } from "../../lib/image-creative/placement";

// The browser-generated drawing represents an owned asset in a different advertiser's project.
test("제작한 광고의 글꼴·카드·규격을 바꿔 원본과 별도 보관하고 세이프 존이 적용된 PNG를 내보낸다", async ({ page }) => {
  await page.goto("/content/images");
  for (const [label, value] of Object.entries({
    "새 작업 이름": "시계 공방 봄 예약", "브랜드명": "담시계", "소재 목표": "공방 예약", "퍼널": "첫 방문",
    "대상": "시계를 만드는 사람", "상품": "시계 수업", "제공 내용": "시계 하나를 직접 만들기",
  })) await page.getByLabel(label, {exact:true}).fill(value);
  await page.getByRole("button", {name:"새 작업 만들기"}).click();
  const photo = await page.evaluate(() => {
    const c=document.createElement("canvas"); c.width=640; c.height=480;
    const g=c.getContext("2d")!; g.fillStyle="#24384b";g.fillRect(0,0,c.width,c.height);
    g.fillStyle="#ead5a6";g.beginPath();g.arc(370,240,140,0,Math.PI*2);g.fill();
    g.strokeStyle="#263748"; g.lineWidth=13;g.beginPath();g.moveTo(370,128);g.lineTo(370,240);g.lineTo(450,261);g.stroke();
    return c.toDataURL().split(",")[1];
  });
  await page.locator('input[type="file"]').setInputFiles({name:"clock.png",mimeType:"image/png",buffer:Buffer.from(photo,"base64")});
  await page.getByRole("group",{name:"창고 디자인 · 피드 4:5"}).getByRole("checkbox").first().check();
  await approveFormat(page);
  const make = page.getByRole("region", {name:"창고 디자인 제작"});
  for (const [label,value] of Object.entries({"공통 소구":"직접 만드는 시계","광고 제목":"내가 고른 시곗바늘","광고 본문":"공방에서 시계를 직접 만들어 보세요.","광고 버튼 문구":"수업 예약하기"})) await make.getByLabel(label,{exact:true}).fill(value);
  await make.getByRole("button",{name:"선택한 포맷 1장 카피 저장"}).click();
  await finishDemoBatch(page,1);
  const results=page.getByRole("region",{name:"4. 시안 비교·선택"});
  const cards=results.locator("article.ic-card");
  const png = async (image: Locator) => image.evaluate(async node => {
    const file=await(await fetch((node as HTMLImageElement).src)).blob();
    const bitmap=await createImageBitmap(file);
    const dims=[bitmap.width,bitmap.height];bitmap.close();
    const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
    return {dims,hash:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("")};
  });
  const base=cards.first();
  await expect(base.getByRole("img")).toBeVisible();
  const original=await png(base.getByRole("img"));
  await base.getByRole("button",{name:"디자인 편집",exact:true}).click();
  const editor=page.getByRole("region",{name:"디자인 편집", exact:true});
  const draft=editor.getByRole("img");
  await expect(editor.getByRole("button",{name:"수정본 저장"})).toBeDisabled();
  await editor.getByLabel("제목 글꼴").selectOption("serif");await expect(draft).toBeVisible();
  const fontOnly=await png(draft);
  expect(fontOnly.dims).toEqual(original.dims);expect(fontOnly.hash).not.toBe(original.hash);
  await editor.getByLabel("카드 디자인").selectOption("frame");await expect(draft).toBeVisible();
  expect((await png(draft)).hash).not.toBe(fontOnly.hash);
  await editor.getByLabel("게재 위치와 비율").selectOption("reel");
  await editor.getByLabel("출력 해상도").selectOption("1440");
  await expect(draft).toBeVisible();
  const withGuide=await png(draft);
  expect(withGuide.dims).toEqual([1440,2560]);
  const policy=resolvePlacement("portrait","reel",1440);
  const safe=editor.locator("svg.ic-safe-overlay rect").first();
  await expect(safe).toHaveAttribute("x",String(policy.safe.x));await expect(safe).toHaveAttribute("y",String(policy.safe.y));
  await expect(safe).toHaveAttribute("width",String(policy.safe.width));await expect(safe).toHaveAttribute("height",String(policy.safe.height));
  await editor.getByLabel("세이프 존 표시",{exact:true}).uncheck();
  await expect(editor.locator("svg.ic-safe-overlay")).toHaveCount(0);expect(await png(draft)).toEqual(withGuide);
  await editor.getByLabel("세이프 존 표시",{exact:true}).check();
  await mkdir("validation/ui",{recursive:true});
  await page.setViewportSize({width:1280,height:1024});
  await editor.evaluate(el=>el.scrollIntoView({block:"start"}));
  await editor.screenshot({path:"validation/ui/image-design-placement-editor.png"});
  await editor.getByRole("button",{name:"수정본 저장",exact:true}).click();
  await expect(cards).toHaveCount(2); await expect(editor).toHaveCount(0);
  await finishDemoBatch(page,2,true);
  const revised=cards.last();await expect(revised.getByRole("img")).toBeVisible();
  expect(await png(base.getByRole("img"))).toEqual(original);expect(await png(revised.getByRole("img"))).toEqual(withGuide);
  await revised.getByRole("button",{name:"기준 시안 선택"}).click();
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
  const [v0,v1]=record.state.variants;expect(v1).toMatchObject({parentId:v0.id,brand:v0.brand,copy:v0.copy,asset:v0.asset,appeal:v0.appeal,design:{font:"serif",card:"frame",placement:"reel",outputWidth:1440}});
  expect(v0.design).toBeUndefined();
  await page.goto("/content/images?project="+record.project.id+"#image-creative-results");
  await expect(revised.getByRole("img")).toBeVisible();expect(await png(revised.getByRole("img"))).toEqual(withGuide);
  await results.getByLabel("결과에 세이프 존 표시").check();
  const [single]=await Promise.all([page.waitForEvent("download"),revised.getByRole("button",{name:"내보내기",exact:true}).click()]);
  const bytes=await readFile((await single.path())!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(withGuide.hash);
  const [bundle]=await Promise.all([page.waitForEvent("download"),results.getByRole("button",{name:"2번째 묶음 ZIP"}).click()]);
  const archive=await JSZip.loadAsync(await readFile((await bundle.path())!));const entry=Object.values(archive.files).find(file=>file.name.endsWith(".png"))!;
  expect((await entry.async("nodebuffer")).equals(bytes)).toBe(true);
  await revised.getByRole("button",{name:"디자인 편집",exact:true}).click();
  await expect(editor.getByLabel("제목 글꼴")).toHaveValue("serif");await expect(editor.getByLabel("출력 해상도")).toHaveValue("1440");
});

test("기존 범용 포맷도 디자인 수정 후 미리보기와 같은 정사각 PNG를 저장한다", async ({page}) => {
  await page.goto("/content/images");
  for (const [label,value] of Object.entries({
    "새 작업 이름":"글자 포스터", "브랜드명":"담시계", "소재 목표":"수업 예약", "퍼널":"첫 예약",
    "대상":"직장인", "상품":"공방 수업", "제공 내용":"나만의 시계",
  })) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole("button",{name:"새 작업 만들기"}).click();
  const picker=page.getByRole("article").filter({has:page.getByRole("heading",{name:"짧은 문장 포스터",exact:true})});
  if(await picker.count())await picker.getByRole("button",{name:"이 포맷 선택"}).click();
  else {await page.getByText("다른 포맷 보기",{exact:true}).click();await page.getByRole("button",{name:"짧은 문장 포스터",exact:true}).click();}
  await page.getByLabel("후보 수").fill("1");
  await page.getByText("구독 AI 결과 직접 가져오기",{exact:true}).click();
  await approveFormat(page);
  await page.getByLabel("결과 JSON").fill(JSON.stringify({variants:[{formatId:"typography",formatVersion:1,size:"portrait",appeal:{id:"craft",meaning:"손으로 만드는 시계"},copy:{headline:"나의 첫 시계",body:"함께 만들어 보세요.",cta:"수업 예약하기"}}]}));
  await page.getByRole("button",{name:"결과 가져오기"}).click();
  await finishDemoBatch(page,1);
  const results=page.getByRole("region",{name:"4. 시안 비교·선택"});
  const cards=results.locator("article.ic-card");await expect(cards).toHaveCount(1);
  await cards.first().getByRole("button",{name:"디자인 편집",exact:true}).click();
  const editor=page.getByRole("region",{name:"디자인 편집",exact:true});
  await editor.getByLabel("제목 글꼴").selectOption("hand");await editor.getByLabel("카드 디자인").selectOption("paper");
  await editor.getByLabel("게재 위치와 비율").selectOption("feed-square");
  await expect(editor.getByRole("button",{name:"수정본 저장"})).toBeEnabled({timeout:30000});
  const preview=await editor.getByRole("img").evaluate(async node=> {
    const b=await(await fetch((node as HTMLImageElement).src)).blob(),im=await createImageBitmap(b);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await b.arrayBuffer())),v=>v.toString(16).padStart(2,"0")).join("");
    const dims=[im.width,im.height];im.close();return {hash,dims};
  });
  expect(preview.dims).toEqual([1080,1080]);
  await editor.getByRole("button",{name:"수정본 저장"}).click();
  await expect(cards).toHaveCount(2);
  await finishDemoBatch(page,2,true);
  const [file]=await Promise.all([page.waitForEvent("download"),cards.last().getByRole("button",{name:"내보내기",exact:true}).click()]);
  expect(createHash("sha256").update(await readFile((await file.path())!)).digest("hex")).toBe(preview.hash);
});

import { approveFormat, finishDemoBatch } from "./image-approval-steps";
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import JSZip from "jszip";
import { FORMAT_TEST_FORMATS, renderFormatTestSvg } from "../../lib/image-creative/format-test-renderer.mjs";
import displayFonts from "../../lib/image-creative/format-test-fonts.json";

test("일반 프로젝트가 업로드 사진과 브랜드로 창고 디자인을 저장하고 같은 PNG로 내보낸다", async ({ page }) => {
  await page.goto("/content/images");
  const site = "솔빛공방";
  const headline = "직접 구운 잔을 만나보세요";
  for (const [label,value] of Object.entries({
    "새 작업 이름":"도자기 첫 출시", "브랜드명":site, "소재 목표":"예약하기", "퍼널":"체험 예약",
    "대상":"도자기 고객","상품":"도자기 수업","제공 내용":"직접 만든 잔 한 개",
  })) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole("button",{name:"새 작업 만들기"}).click();
  // The selected project uses a different subject and palette from the bundled campaign photograph.
  const illustration = await page.evaluate(() => {
    const c=document.createElement("canvas"); c.width=480; c.height=320;
    const g=c.getContext("2d")!;g.fillStyle="#c25f21";g.fillRect(0,0,480,320);
    g.fillStyle="#fff0bd";g.fillRect(140,105,180,120);g.beginPath();g.ellipse(230,105,90,24,0,0,Math.PI*2);g.fill();
    g.lineWidth=15;g.strokeStyle="#fff0bd";g.beginPath();g.arc(322,157,36,-Math.PI/2,Math.PI/2);g.stroke();
    g.fillStyle="#e2aa59";g.beginPath();g.ellipse(230,105,80,16,0,0,Math.PI*2);g.fill();
    g.strokeStyle="#245055";g.lineWidth=10;g.beginPath();g.moveTo(150,177);g.bezierCurveTo(185,131,206,208,244,180);g.stroke();
    g.strokeStyle="#254542";g.lineWidth=9;g.beginPath();g.moveTo(269,229);g.lineTo(238,182);g.stroke();
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type="file"]').setInputFiles({name:"cup.png",mimeType:"image/png",buffer:Buffer.from(illustration,"base64")});
  const catalog=page.getByRole("region",{name:"포맷 창고"});const group=page.getByRole("group",{name:"창고 디자인 · 피드 4:5"});
  await catalog.getByLabel("찾을 포맷").fill("M01");
  await catalog.getByText("속마음 말풍선",{exact:true}).click();
  await catalog.getByRole("button",{name:"이 작업에 사용"}).click();
  for (const box of (await group.getByRole("checkbox").all()).slice(1)) await box.check();
  await approveFormat(page);
  const make=page.getByRole("region",{name:"창고 디자인 제작"});
  for (const [label,value] of Object.entries({"공통 소구":"나만의 잔 만들기","광고 제목":headline,"광고 본문":"오늘 내 손으로 빚어 보세요.","광고 버튼 문구":"수업 예약하기"})) await make.getByLabel(label,{exact:true}).fill(value);
  await make.getByRole("button",{name:"선택한 포맷 5장 카피 저장"}).click();

  await finishDemoBatch(page,1);
  const results=page.getByRole("region",{name:"4. 시안 비교·선택"});
  const images=results.getByRole("img",{name:headline,exact:true});
  await expect(images).toHaveCount(5,{timeout:30000});
  const preview=async()=> images.evaluateAll(async nodes=>Promise.all(nodes.map(async node=>{
    const content=await(await fetch((node as HTMLImageElement).src)).arrayBuffer();
    const pixels=await createImageBitmap(new Blob([content],{type:"image/png"}));
    const sum=await crypto.subtle.digest("SHA-256",content);
    const size=[pixels.width,pixels.height];pixels.close();
    return {size,hash:Array.from(new Uint8Array(sum),v=>v.toString(16).padStart(2,"0")).join("")};
  })));
  const original=await preview();
  expect(original.every(x=>x.size[0]===1080&&x.size[1]===1350)).toBe(true);
  expect(new Set(original.map(x=>x.hash)).size).toBe(5);
  // Independently render the known project brief and its test photograph. A fixed
  // campaign thumbnail could also match its own downloaded PNG, but cannot match this.
  const copy = {brand:site, headline, support:"오늘 내 손으로 빚어 보세요.", cta:"수업 예약하기"};
  const fontUrl = async (path:string) => "data:font/woff2;base64," + (await readFile(path)).toString("base64");
  const fontData = await fontUrl("public/fonts/pretendard/PretendardVariable.woff2");
  for (const [index,format] of FORMAT_TEST_FORMATS.entries()) {
    const face = displayFonts[format.id as keyof typeof displayFonts];
    const svg = renderFormatTestSvg({formatId:format.id,copy,photo:"data:image/png;base64,"+illustration,fontData,
      displayFontData:face ? await fontUrl("public/image-format-test/fonts/"+face) : undefined});
    const expected = await page.evaluate(async source => {
      const u=URL.createObjectURL(new Blob([source],{type:"image/svg+xml;charset=utf-8"}));
      try {
        const img=new Image();img.src=u;await img.decode();
        const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d", { willReadFrequently: true })!.drawImage(img,0,0);
        const png = await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error("PNG")),"image/png"));
        const sum = await crypto.subtle.digest("SHA-256",await png.arrayBuffer());
        return Array.from(new Uint8Array(sum),b=>b.toString(16).padStart(2,"0")).join("");
      } finally { URL.revokeObjectURL(u); }
    },svg);
    expect(original[index].hash).toBe(expected);
  }
  const first=results.locator("article").first();
  await first.getByRole("button",{name:"기준 시안 선택"}).click();
  const id=await page.getByLabel("기존 작업").inputValue();
  await page.goto("/content/images?project="+encodeURIComponent(id)+"#image-creative-results");
  await expect(images).toHaveCount(5,{timeout:30000});
  expect(await preview()).toEqual(original);
  await expect(first.getByRole("button",{name:"기준으로 선택됨"})).toBeVisible();
  const [png]=await Promise.all([page.waitForEvent("download"),first.getByRole("button",{name:"내보내기"}).click()]);
  expect(createHash("sha256").update(await readFile((await png.path())!)).digest("hex")).toBe(original[0].hash);
  const [download]=await Promise.all([page.waitForEvent("download"),results.getByRole("button",{name:"1번째 묶음 ZIP"}).click()]);
  const zip=await JSZip.loadAsync(await readFile((await download.path())!));
  const meta=JSON.parse(await zip.file("variants.json")!.async("string"));
  expect(meta.brief.brand).toBe(site);
  expect(meta.variants.map((v: {formatId:string})=>v.formatId)).toEqual(["M01","A04","A10","D12","M09"]);
  expect(meta.batch.compareFormats).toBe(true);
  const files=Object.values(zip.files).filter(entry=>entry.name.endsWith(".png")).sort((a,b)=>a.name.localeCompare(b.name));
  expect(await Promise.all(files.map(async file=>createHash("sha256").update(await file.async("nodebuffer")).digest("hex")))).toEqual(original.map(x=>x.hash));
  await mkdir("validation/ui",{recursive:true});await results.screenshot({path:"validation/ui/warehouse-real-project.png"});
  await page.getByRole("button",{name:"소구점 비교",exact:true}).click();
  await page.getByLabel("후보 수").fill("1");
  await page.getByText("구독 AI 결과 직접 가져오기",{exact:true}).click();
  await approveFormat(page);
  await page.getByLabel("결과 JSON").fill(JSON.stringify({variants:[{appeal:{id:"new",meaning:"소중한 사람에게 주는 선물"},copy:{headline:"함께 빚은 잔을 선물하세요",body:"선물할 잔을 만들어 보세요.",cta:"수업 예약하기"}}]}));
  await page.getByRole("button",{name:"결과 가져오기"}).click();
  await finishDemoBatch(page,2);
  const changed=results.locator("article").filter({has:page.getByRole("heading",{name:"함께 빚은 잔을 선물하세요"})});
  await expect(changed.getByRole("img")).toBeVisible();
  await changed.getByRole("button",{name:"기준 시안 선택"}).click();
  await page.getByRole("button",{name:"카피 비교",exact:true}).click();
  await expect(page.getByRole("group",{name:"바꿀 카피"}).getByLabel("버튼")).toBeDisabled();
  await approveFormat(page);
  await page.getByLabel("결과 JSON").fill(JSON.stringify({variants:[{copy:{headline:"선물하는 잔 한 개"}}]}));await page.getByRole("button",{name:"결과 가져오기"}).click();
  await finishDemoBatch(page,3);
  const copied=results.locator("article").filter({has:page.getByRole("heading",{name:"선물하는 잔 한 개"})});
  await copied.getByRole("button",{name:"기준 시안 선택"}).click();await page.getByRole("button",{name:"이미지 비교",exact:true}).click();
  const second=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=400;c.height=300;const ctx=c.getContext("2d")!;ctx.fillStyle="#167544";ctx.fillRect(0,0,400,300);return c.toDataURL("image/png").split(",")[1]});
  await page.locator('input[type="file"]').setInputFiles({name:"green-cup.png",mimeType:"image/png",buffer:Buffer.from(second,"base64")});
  await expect(page.getByText("이미지 2 · 400×300",{exact:true})).toBeVisible();
  const nextAsset=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0].assets.at(-1));
  await approveFormat(page);
  await page.getByLabel("결과 JSON").fill(JSON.stringify({variants:[{asset:{path:nextAsset.path,w:400,h:300}}]}));await page.getByRole("button",{name:"결과 가져오기"}).click();
  await finishDemoBatch(page,4);
  await expect(results.locator("article").last().getByRole("img",{name:"선물하는 잔 한 개"})).toBeVisible();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0].state);
  expect(state.batches.map((b:{mode:string})=>b.mode)).toEqual(["initial","appeal","copy","image"]);
  expect(state.variants.at(-1)).toMatchObject({formatVersion:2,formatId:"M01",brand:site,asset:{path:nextAsset.path},copy:{headline:"선물하는 잔 한 개",cta:"수업 예약하기"}});
  await page.getByLabel("새 작업 이름",{exact:true}).fill("별도 새 작업");
  await page.getByRole("button",{name:"새 작업 만들기"}).click();
  await expect(page.getByLabel("브랜드명",{exact:true})).toHaveValue("");
  await expect(page.getByLabel("퍼널",{exact:true})).toHaveValue("");
  await expect(results.locator("article")).toHaveCount(0);
  await expect(group.getByRole("checkbox",{checked:true})).toHaveCount(0);
  await expect(page.getByText("아직 올린 이미지가 없어요.")).toBeVisible();
});

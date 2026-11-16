import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { draftReferenceLayout } from "../../lib/image-creative/reference-layout";
import { emptyImageCreative } from "../../lib/image-creative/model";
import { selectedReferencePlan } from "../../lib/image-creative/direction";

test("레퍼런스 선택에서 광고 원본과 로드 실패 시 대체한 구성 예시를 구분한다", async ({page}) => {
  const project = {id:crypto.randomUUID(),title:"레퍼런스 표시 점검",version:1};
  const state = emptyImageCreative();
  state.experiment = true;
  state.brief = {...state.brief,brand:"공방",product:"공예 수업",objective:"신청",audience:"입문자",offer:"체험 수업"};
  state.formatRecommendation = selectedReferencePlan(state.brief,"appeal","portrait",[{id:"craft",meaning:"직접 만들어 보기"}]);
  await page.addInitScript(bundle=>localStorage.setItem("os-image-creatives-demo-v1",JSON.stringify([bundle])),{project,state,jobs:[],assets:[]});
  const card = {group:"디자인",keep:"구성을 확인하세요.",slots:"문구",source:"",version:1,documentId:""};
  const samples = [{...card,id:"M01",name:"조회되는 원본",thumbnail:"/qa-reference-ok.svg"},
    {...card,id:"A04",name:"조회되지 않는 원본",thumbnail:"/qa-reference-broken.png"},
    {...card,id:"A10",name:"잘못된 위치 파일",thumbnail:"/image-format-test/master.jpg",masterRecipe:"{}"}];
  await page.route(/\/api\/(dev\/image-ad-references|v1\/content\/image-creatives\/references(?:\/examples)?)$/,route=>route.fulfill({json:{entries:samples}}));
  let allowLoad!: () => void;
  const pending = new Promise<void>(resolve=>{allowLoad=resolve;});
  await page.route("**/qa-reference-ok.svg",async route=>{
    await pending;
    await route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="15"><rect width="12" height="15"/></svg>'});
  });
  await page.route("**/qa-reference-broken.png",route=>route.fulfill({status:404,body:""}));
  await page.goto("/content/images?view=tests&project="+project.id,{waitUntil:"domcontentloaded"});
  const original = page.getByRole("button",{name:"조회되는 원본",exact:true});
  try {
    await expect(original).toHaveAccessibleDescription(/광고 원본 불러오는 중/);
  } finally { allowLoad(); }
  await expect(original.getByText("광고 원본",{exact:true})).toBeVisible();
  await expect(original).toHaveAccessibleDescription(/^광고 원본 /);
  const missing = page.getByRole("button",{name:"조회되지 않는 원본",exact:true});
  await missing.scrollIntoViewIfNeeded();
  await expect(missing.getByText("구성 예시 · 원본 로드 실패",{exact:true})).toBeVisible();
  await expect(missing).toHaveAccessibleDescription(/구성 예시 · 원본 로드 실패/);
  await expect.poll(()=>missing.getByRole("img").evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await missing.click();
  await page.getByRole("button",{name:"이 레퍼런스로 제작"}).click();
  await expect(page.getByRole("alert").filter({hasText:"원 광고 이미지를 불러오지 못했어요"})).toBeVisible();
  await expect(page.getByRole("group",{name:"원본 광고와 교체 시안"})).toHaveCount(0);
  await page.getByRole("button",{name:"잘못된 위치 파일",exact:true}).click();
  await page.getByRole("button",{name:"이 레퍼런스로 제작"}).click();
  await expect(page.getByRole("alert").filter({hasText:"교체 위치 파일"})).toBeVisible();
  await expect(page.getByRole("group",{name:"원본 광고와 교체 시안"})).toHaveCount(0);
  const example = page.getByRole("button",{name:"짧은 문장 포스터",exact:true});
  await expect(example.getByText("구성 예시",{exact:true})).toBeVisible();
  await example.click();
  await expect(example).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("button",{name:"카피 작성하기",exact:true})).toBeEnabled();
});

test("반응·성과에서 콘텐츠 자동화를 통해 이미지 광고와 A/B 프로젝트를 연다", async ({page}) => {
  await page.goto("/automation/performance");
  const group = page.getByRole("button", {name:"콘텐츠 자동화", exact:true});
  await expect(group).toBeVisible();
  if (await group.getAttribute("aria-expanded") === "false") await group.click();
  await page.locator('[data-stage="automation"]').getByRole("link", {name:"이미지 광고", exact:true}).click();
  await expect(page.getByRole("navigation", {name:"현재 위치"}).getByRole("link", {name:"콘텐츠 자동화"})).toBeVisible();
  await page.getByRole("button", {name:"여러 안 테스트하기", exact:true}).click();
  await expect(page.getByRole("heading", {name:"A/B 테스트 프로젝트", exact:true})).toBeVisible();
  await expect(page.locator('[data-stage="automation"] a.page-link[aria-current="page"]')).toHaveText("이미지 광고");
});

test("첫 화면은 모바일에서도 한 장 제작과 여러 안 테스트를 바로 시작할 수 있다", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/content/images");
  for (const title of ["광고 한 장 만들기", "여러 안 테스트하기"]) {
    const button = page.getByRole("button", {name:title, exact:true});
    await expect(button).toBeInViewport();
  }
  await expect(page.getByRole("region",{name:"포맷 창고"})).toHaveCount(0);
  await expect(page.getByLabel("이미지를 출력할 컴퓨터")).toHaveCount(0);
  await page.getByRole("button",{name:"광고 한 장 만들기", exact:true}).click();
  await expect(page.getByRole("heading",{name:"상품 선택",exact:true})).toBeVisible();
  await expect(page.getByLabel("메인 메시지",{exact:true})).toHaveCount(0);
  await expect(page.getByLabel("소구점 수")).toHaveCount(0);
});

test("단독 광고를 소구점 직접 작성부터 디자인 수정과 최종 확정까지 진행한다", async ({page})=>{
  await page.goto("/content/images");
  await page.getByRole("button",{name:"광고 한 장 만들기",exact:true}).click();
  await page.getByRole("combobox",{name:"상품 선택",exact:true}).selectOption("__demo");
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await expect(page.getByRole("button",{name:"AI에게 추천받기",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"레퍼런스 선택하기",exact:true})).toBeDisabled();
  const motive="퇴근 후 직접 만든 컵으로 쉬고 싶다";
  await page.getByLabel("소구점 직접 작성",{exact:true}).fill(motive);
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"레퍼런스 선택",exact:true})).toBeVisible();
  await page.reload();
  const card=page.getByRole("button",{name:"짧은 문장 포스터",exact:true});
  await expect.poll(()=>card.getByRole("img").evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("button",{name:"카피 작성하기",exact:true})).toBeDisabled();
  await page.getByText(/다른 레퍼런스 [0-9]+개 보기/).click();
  await page.getByRole("button",{name:"썸네일형 · 한 장면",exact:true}).click();
  await page.getByLabel("이미지 올리기").setInputFiles("public/image-format-test/master.jpg");
  await expect(page.getByRole("radio",{name:"등록 이미지 1",exact:true})).toBeChecked();
  await card.click();
  await page.getByRole("radio",{name:"사진 없이 제작",exact:true}).check();
  await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
  await page.getByLabel("제목",{exact:true}).fill("내가 빚은 컵");
  await page.getByLabel("본문",{exact:true}).fill("퇴근 후 공방에서 쉬어가요");
  await page.getByLabel("버튼 문구",{exact:true}).fill("예약하기");
  await expect(page.getByRole("button",{name:"최종 검수 완료",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"카피 확정 · 디자인 수정하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"디자인 수정",exact:true})).toBeVisible();
  const review=page.getByRole("region",{name:"1번째 묶음 검토",exact:true});
  await expect(review.getByText(motive,{exact:true})).toBeVisible();
  await expect(review.getByText("퇴근 후 공방에서 쉬어가요",{exact:true})).toBeVisible();
  await review.getByRole("button",{name:"디자인 편집",exact:true}).click();
  const editor=page.getByRole("region",{name:"디자인 편집",exact:true});
  await editor.getByLabel("제목 글꼴").selectOption("serif");
  await editor.getByRole("button",{name:"수정본 저장",exact:true}).click({timeout:45000});
  const revision=page.getByRole("region",{name:"2번째 묶음 검토",exact:true});
  await expect(revision.getByText(/명조 · 고운바탕/)).toBeVisible();
  await expect(revision.getByText("내가 빚은 컵",{exact:true})).toBeVisible();
  await expect(revision.getByRole("button",{name:"묶음 포맷 승인",exact:true})).toHaveCount(0);
  await revision.getByRole("button",{name:/미리보기 확인.*체험 출력/}).click({timeout:45000});
  await expect(page.getByRole("heading",{name:"확정",exact:true})).toBeVisible();
  await revision.getByRole("button",{name:"최종 검수 완료",exact:true}).click();
  await expect(revision.getByRole("button",{name:"내보내기",exact:true})).toBeEnabled();
  await page.reload();
  await expect(revision.getByText("최종 검수 완료",{exact:true})).toBeVisible();
});


test("저장된 소구점은 다시 요청하지 않고 기존 ID로 선택한다",async ({page})=>{
  const project={id:crypto.randomUUID(),title:"저장된 소구점이 있는 프로젝트",version:2};
  const options=[{id:"after-work",meaning:"퇴근 후 한 시간 쉬어가기"},{id:"gift",meaning:"직접 만든 컵 선물하기"}];
  const state=emptyImageCreative();
  state.experiment=true;
  state.brief={...state.brief,objective:"수업 예약",brand:"공방",product:"도자기 수업",audience:"도예 입문자",offer:"직접 빚은 컵"};
  state.formatRecommendation={mode:"appeal",size:"portrait",count:options.length,appealFirst:true,referenceFirst:true,appealOptions:options};
  await page.addInitScript(bundle=>localStorage.setItem("os-image-creatives-demo-v1",JSON.stringify([bundle])),{project,state,jobs:[],assets:[]});
  await page.goto("/content/images?view=tests&project="+project.id);
  await expect(page.getByRole("button",{name:"AI에게 추천받기"})).toHaveCount(0);
  await page.getByRole("button",{name:"저장된 소구점 보기"}).click();
  await page.getByRole("checkbox",{name:options[1].meaning,exact:true}).check();
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"레퍼런스 선택",exact:true})).toBeVisible();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0].state.formatRecommendation);
  expect(saved.appeals).toEqual([options[1]]);
  expect(saved.appealOptions).toEqual(options);
});

test("이전 소구점 기획을 저장하기 전까지 보존하고 새 소구점은 직접 작성한다", async ({page})=>{
  const project={id:crypto.randomUUID(),title:"이전 광고 기획",version:2};
  const state=emptyImageCreative();
  state.experiment=true;
  state.brief={...state.brief,objective:"수업 예약",brand:"공방",product:"도자기 수업",audience:"도예 입문자",offer:"직접 빚은 컵"};
  const appeals=[{id:"gift",meaning:"직접 만든 컵 선물하기"}];
  state.formatRecommendation={mode:"appeal",size:"portrait",count:1,appealFirst:true,conceptFirst:true,appeals,concepts:["따뜻한 선물"]};
  await page.addInitScript(bundle=>{if (!localStorage.getItem("os-image-creatives-demo-v1"))
    localStorage.setItem("os-image-creatives-demo-v1",JSON.stringify([bundle]));},{project,state,jobs:[],assets:[]});
  const url="/content/images?view=tests&project="+project.id;
  await page.goto(url);
  await expect(page.getByText(appeals[0].meaning,{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"기획 수정",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"소구점 직접 작성",exact:true})).toHaveValue(appeals[0].meaning);
  await page.getByRole("textbox",{name:"소구점 직접 작성",exact:true}).fill("수정 중인 소구점");
  await page.reload();
  await expect(page.getByText(appeals[0].meaning,{exact:true})).toBeVisible();
  await page.evaluate(() => {
    const key="os-image-creatives-demo-v1";
    const [saved]=JSON.parse(localStorage.getItem(key)!);
    delete saved.state.formatRecommendation.appeals;
    delete saved.state.formatRecommendation.concepts;
    saved.jobs=[{id:"prior-attempt",phase:"formats",currentInput:true,status:"blocked"}];
    localStorage.setItem(key,JSON.stringify([saved]));
  });
  await page.reload();
  await expect(page.getByRole("button",{name:/제안받기|다시 요청하기/})).toHaveCount(0);
  await page.getByRole("textbox",{name:"소구점 직접 작성",exact:true}).fill("퇴근 후 공방에서 쉬어가기");
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"레퍼런스 선택",exact:true})).toBeVisible();
});

test("새 WebP 광고에서 교체 영역을 지정하고 원본·사진·승인을 다시 연다", async ({page})=>{
  await page.goto("/content/images");
  await page.getByRole("button",{name:"광고 한 장 만들기",exact:true}).click();
  const products=page.getByRole("combobox",{name:"상품 선택",exact:true});
  const sample=products.locator('option[value="__demo"], option[value="myin-free"]').first();
  await expect(sample).toBeAttached();
  await products.selectOption((await sample.getAttribute("value"))!);
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await page.getByLabel("소구점 직접 작성",{exact:true}).fill("직접 만든 컵을 선물하기");
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await page.getByRole("button",{name:"새 레퍼런스 이미지 사용"}).click();
  const original=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");
    canvas.width=240;canvas.height=240;
    const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#f6e4b9";ctx.fillRect(0,0,240,300);
    ctx.fillStyle="#593f32";ctx.font="bold 20px sans-serif";ctx.fillText("SAMPLE",20,44);
    return canvas.toDataURL("image/webp").split(",")[1];
  });
  await page.getByLabel("레퍼런스 원본 올리기").setInputFiles({name:"sample.webp",mimeType:"image/webp",buffer:Buffer.from(original,"base64")});
  await expect(page.getByRole("combobox",{name:"구도",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"원본의 교체 영역 편집"}).click();
  await expect(page.getByAltText("레퍼런스 원본과 교체 영역")).toBeVisible();
  await expect(page.getByRole("combobox",{name:"출력 규격"})).toHaveValue("square");
  await page.getByLabel("사진 교체",{exact:true}).check();
  const next=page.getByRole("button",{name:"카피 작성하기",exact:true});
  await expect(next).toBeDisabled();
  await page.getByLabel("교체 사진 올리기").setInputFiles("public/image-format-test/master.jpg");
  const preview=page.getByRole("group",{name:"원본 광고와 교체 시안"});
  await expect(preview.locator('[data-image-master="1"]')).toBeVisible();
  await expect(page.getByRole("combobox",{name:"구도",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"그래픽 칸 추가"}).click();
  await expect(next).toBeDisabled();
  await page.getByLabel("그래픽에 사용할 이미지").selectOption("photo");
  await expect(preview.locator("[data-image-detail='1'] img")).toBeVisible();
  await expect(next).toBeEnabled();
  await page.getByLabel("그래픽에 사용할 이미지").selectOption("detail");
  await page.getByRole("radio",{name:"그래픽 원본 2",exact:true}).check();
  await expect(next).toBeEnabled();
  const logo=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=80;canvas.height=48;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle="#257e51";ctx.fillRect(4,4,32,32);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("그래픽 원본 올리기").setInputFiles({name:"mark.png",mimeType:"image/png",buffer:Buffer.from(logo,"base64")});
  await expect(page.getByRole("radio",{name:"그래픽 원본 3",exact:true})).toBeChecked();
  await expect(page.getByRole("radio",{name:"이미지 2",exact:true})).toBeChecked();
  const cropBoard=page.getByAltText("그래픽 원본에서 선택한 부분");
  await cropBoard.scrollIntoViewIfNeeded();
  const cropRect=await cropBoard.boundingBox();
  if(!cropRect) throw new Error("그래픽에서 자를 부분이 보이지 않습니다.");
  await page.mouse.move(cropRect.x+5,cropRect.y+5);await page.mouse.down();
  await page.mouse.move(cropRect.x+cropRect.width*.48,cropRect.y+cropRect.height*.8,{steps:3});await page.mouse.up();
  await page.getByText("자르는 위치와 크기",{exact:true}).click();
  await expect(page.getByLabel("원본 너비 (%)",{exact:true})).not.toHaveValue("100");
  await page.getByLabel("원본 너비 (%)",{exact:true}).fill("48");
  await page.getByLabel("그래픽 모서리 둥글기 (%)",{exact:true}).fill("15");
  await page.getByLabel("그래픽 맞춤").selectOption("cover");
  await expect(preview.locator("[data-image-detail='1'] img")).toHaveAttribute("src",/^data:image\/png;/);
  await page.getByRole("button",{name:"브랜드 칸 추가"}).click();
  await expect(preview.locator('[data-image-field="brand"]')).toHaveText("산들공방");
  await page.getByLabel("글자 크기").fill("32");
  await page.getByLabel("브랜드 1 굵기").selectOption("900");
  await page.getByRole("button",{name:"가릴 영역 추가"}).click();
  await page.getByRole("button",{name:"원본에서 색 찍기"}).click();
  await page.getByAltText("레퍼런스 원본과 교체 영역").click({position:{x:8,y:8}});
  await expect(page.getByLabel("가림색")).not.toHaveValue("#000000");
  await page.getByRole("button",{name:"원본 무늬로 가리기"}).click();
  await page.getByAltText("레퍼런스 원본과 교체 영역").click({position:{x:14,y:15}});
  await page.getByLabel("복사할 왼쪽 (%)").fill("11");
  await page.getByLabel("복사한 무늬 좌우 반전").check();
  await page.getByRole("button",{name:"사진 위에 원본 장식 유지"}).click();
  await page.getByLabel("모서리 둥글기 (%)").fill("10");
  await page.getByLabel("본문 두 칸에 나누기").check();
  await expect(page.getByRole("option",{name:"본문 다음 줄"})).toBeAttached();
  await page.getByLabel("본문 두 칸에 나누기").uncheck();
  await page.getByText("같은 원본에 교체 위치 재사용").click();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"교체 위치 저장",exact:true}).click();
  const file=await (await downloading).path();
  if(!file) throw new Error("교체 위치 파일이 없습니다.");
  await page.getByLabel("편집할 영역").selectOption("0");
  await page.getByRole("button",{name:"가림 삭제"}).click();
  await expect(page.getByRole("option",{name:"가림 1",exact:true})).toHaveCount(0);
  await page.getByLabel("저장한 교체 위치 적용").setInputFiles(file);
  await expect(page.getByRole("option",{name:"가림 1",exact:true})).toBeAttached();
  await page.getByRole("button",{name:"제목 영역",exact:true}).click();
  await page.getByText("위치와 크기 조정",{exact:true}).click();
  await page.getByLabel("너비 (%)",{exact:true}).fill("55");
  await page.getByLabel("왼쪽 (%)",{exact:true}).fill("16");
  const headingBox=await page.getByRole("button",{name:"제목 영역",exact:true}).boundingBox();
  if(!headingBox)throw new Error("교체할 제목 영역이 보이지 않습니다.");
  await page.mouse.move(headingBox.x+10,headingBox.y+5);
  await page.mouse.down();
  await page.mouse.move(headingBox.x+28,headingBox.y+5,{steps:4});
  await page.mouse.up();
  await expect(page.getByLabel("왼쪽 (%)",{exact:true})).not.toHaveValue("16");
  await page.getByLabel("왼쪽 (%)",{exact:true}).fill("16");
  await next.click();
  await expect(page.getByRole("heading",{name:"카피 작성",exact:true})).toBeVisible();
  await page.getByLabel("제목",{exact:true}).fill("직접 빚은 컵");
  await page.getByLabel("버튼 문구",{exact:true}).fill("수업 살펴보기");
  await page.getByRole("button",{name:"초안 저장",exact:true}).click();
  await expect(page.getByText("초안 저장됨 · 카피 승인 대기",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("제목",{exact:true})).toHaveValue("직접 빚은 컵");
  await expect(preview.locator("[data-image-detail='1'] img")).toHaveAttribute("src",/^data:image\/png;/);
  await expect(preview.locator('[data-image-field="brand"]')).toHaveText("산들공방");
  await expect(page.getByLabel("버튼 문구",{exact:true})).toHaveValue("수업 살펴보기");
  await expect(page.getByRole("button",{name:"초안 저장",exact:true})).toBeDisabled();
  const draft = await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
  expect(draft.state.batches).toHaveLength(0);
  expect(draft.jobs).toHaveLength(0);
  await page.getByRole("button",{name:"레퍼런스 변경"}).click();
  await expect(page.getByRole("radio",{name:"이미지 2",exact:true})).toBeChecked();
  await page.getByText("위치와 크기 조정",{exact:true}).click();
  await expect(page.getByLabel("너비 (%)",{exact:true})).toHaveValue("55");
  await expect(page.getByLabel("왼쪽 (%)",{exact:true})).toHaveValue("16");
  await expect(page.getByRole("combobox",{name:"출력 규격"})).toHaveValue("square");
  const request=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0].state.formatApproval.request);
  expect(request.formatIds).toEqual(["reference_image"]);
  expect(request.size).toBe("square");
  expect(request.referenceLayout.master.regions).toHaveLength(1);
  expect(request.referenceLayout.master.regions[0].sample).toMatchObject({x:11,flipX:true});
  expect(request.referenceLayout.master.keepOverPhoto[0].radius).toBe(10);
  expect(request.referenceLayout.master.brandSlots[0]).toMatchObject({fontSize:32,weight:900});
  expect(request.referenceLayout.master.detailSlots[0]).toMatchObject({crop:{w:48},source:"detail",radius:15,fit:"cover"});
  expect(request.detailAssetPath).toBe(draft.assets[2].path);
  expect(request.assetPaths).toEqual([draft.assets[1].path]);
  await expect(page.getByRole("radio",{name:"그래픽 원본 3",exact:true})).toBeChecked();
  expect(request.referenceLayout.composition).toBeUndefined();
  expect(request.referenceLayout.source.path).toMatch(/\.png$/);
  expect(request.assetPaths).toHaveLength(1);
  expect(request.assetPaths[0]).not.toBe(request.referenceLayout.source.path);
  await next.click();
  await page.getByLabel("제목",{exact:true}).fill("컵");
  await page.getByLabel("버튼 문구",{exact:true}).fill("보기");
  await page.getByRole("button",{name:"카피 확정 · 디자인 수정하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"디자인 수정",exact:true})).toBeVisible();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0].state.variants[0]);
  expect(stored.asset.path).toBe(request.assetPaths[0]);
  expect(stored.detailAsset.path).toBe(request.detailAssetPath);
  expect(stored.referenceLayout.master.detailSlots).toEqual(request.referenceLayout.master.detailSlots);
});

for (const source of ["직접 업로드", "창고 보관본"] as const) {
  test(`${source} 레퍼런스로 카피 입력 중 실제 구도를 보고 카피 승인 전 초안을 다시 연다`, async ({page}) => {
    const warehouse = source === "창고 보관본";
    const archived = "/image-format-test/master.jpg";
    if (warehouse) {
      const original=await readFile("public"+archived);
      const {width,height}=await page.evaluate(async data=>{
        const image=new Image();image.src="data:image/jpeg;base64,"+data;await image.decode();
        return {width:image.naturalWidth,height:image.naturalHeight};
      },original.toString("base64"));
      const {headline,body,cta,photo}=draftReferenceLayout({path:"fixture",w:width,h:height});
      const masterRecipe=JSON.stringify({format:"os-reference-master/1",width,height,sha256:createHash("sha256").update(original).digest("hex"),
        template:{headline,body,cta,photo,master:{v:1,headlineWeight:900,regions:[],background:"#eadcad"}}});
      await page.route(/\/api\/(dev\/image-ad-references|v1\/content\/image-creatives\/references(?:\/examples)?)$/, route => route.fulfill({json:{entries:[{
        id:"M01", name:"공방 사진 견본", group:"디자인", keep:"사진과 제목", slots:"상품 사진", source:"", thumbnail:"/qa-gone.png",
        archivedThumbnail:"/image-format-test/examples/note-portrait.webp", originalImageUrl:archived, masterRecipe, documentId:crypto.randomUUID(), version:1,
      }]}}));
      await page.route("**/qa-gone.png", route=>route.fulfill({status:404}));
    }
    await page.goto("/content/images");
    await page.getByRole("button",{name:"광고 한 장 만들기",exact:true}).click();
    await page.getByRole("combobox",{name:"상품 선택",exact:true}).selectOption("__demo");
    await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
    await page.getByLabel("소구점 직접 작성",{exact:true}).fill("직접 만드는 컵");
    await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
    if (warehouse) {
      await page.getByRole("button",{name:"공방 사진 견본",exact:true}).click();
      await page.getByRole("button",{name:"이 레퍼런스로 제작"}).click();
    } else {
      await page.getByRole("button",{name:"새 레퍼런스 이미지 사용"}).click();
      await page.getByLabel("레퍼런스 원본 올리기").setInputFiles("public"+archived);
    }
    await page.getByLabel("사진 교체",{exact:true}).check();
    if(warehouse) await expect(page.getByRole("combobox",{name:"편집할 영역"})).toBeVisible();
    else {
      await page.getByRole("combobox",{name:"구도",exact:true}).selectOption("split");
      await page.getByRole("combobox",{name:"사진 맞춤",exact:true}).selectOption("cover");
      await page.getByRole("button",{name:"원본의 교체 영역 편집"}).click();
      await expect(page.getByRole("combobox",{name:"편집할 영역"})).toBeVisible();
      await page.getByRole("button",{name:"새 구도로 다시 배치"}).click();
      await expect(page.getByRole("combobox",{name:"구도",exact:true})).toHaveValue("split");
    }
    const writeCopy = page.getByRole("button",{name:"카피 작성하기",exact:true});
    await expect(writeCopy).toBeDisabled();
    await page.getByLabel("교체 사진 올리기").setInputFiles("public/image-format-test/thumbnail-subject.jpg");
    await writeCopy.click();

    const compare=page.getByRole("group",{name:"원본 광고와 교체 시안"});
    const artwork=compare.locator(warehouse ? '[data-image-master="1"]' : '[data-image-composition="split"]');
    await page.getByLabel("제목",{exact:true}).fill("직접 빚은 컵");
    await page.getByLabel("본문",{exact:true}).fill("공방에서 만나요");
    await page.getByLabel("버튼 문구",{exact:true}).fill("신청하기");
    await expect(artwork.locator('[data-image-field="headline"]')).toHaveText("직접 빚은 컵");
    await expect(artwork.locator('[data-image-field="body"]')).toHaveText("공방에서 만나요");
    await expect(artwork.locator('[data-image-field="cta"]')).toHaveText("신청하기");
    await expect(artwork.locator("img")).toHaveCount(warehouse ? 2 : 1);
    const original=await compare.getByAltText("선택한 레퍼런스 원본").getAttribute("src");
    if(warehouse) await expect(artwork.locator("img").first()).toHaveAttribute("src",original!);
    expect(await artwork.locator("img").last().getAttribute("src")).not.toBe(original);
    await page.getByLabel("제목",{exact:true}).fill("나만의 컵");
    await expect(artwork.locator('[data-image-field="headline"]')).toHaveText("나만의 컵");
    await page.getByRole("button",{name:"초안 저장",exact:true}).click();
    await expect(page.getByText("초안 저장됨 · 카피 승인 대기")).toBeVisible();
    await page.reload();
    await expect(artwork.locator('[data-image-field="headline"]')).toHaveText("나만의 컵");
    const bundle = await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
    const layout=bundle.state.formatApproval.request.referenceLayout;
    if(warehouse) {
      expect(layout.master).toMatchObject({v:1,regions:[],headlineWeight:900,background:"#eadcad"});
      expect(layout.composition).toBeUndefined();
    } else expect(layout.composition).toMatchObject({style:"split",fit:"cover"});
    expect(bundle.state.formatApproval.copyDraft[0].headline).toBe("나만의 컵");
    expect(bundle.state.batches).toHaveLength(0);
    expect(bundle.jobs).toHaveLength(0);
  });
}

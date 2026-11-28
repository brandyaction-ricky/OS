import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { draftReferenceLayout, type ReferenceLayout } from "../../lib/image-creative/reference-layout";
import { approveImageFormat, confirmReferenceCopy, createImageBatch, emptyImageCreative, reviewImageBatch, saveReferenceCopyDraft, startImageCopyBatch, type ImageBatchRequest } from "../../lib/image-creative/model";
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
  await expect(page.getByAltText("AI에 전달할 레퍼런스 원본 전체")).toBeVisible();
  await expect(page.getByRole("alert").filter({hasText:"교체 위치 파일"})).toHaveCount(0);
  await expect(page.getByRole("group",{name:"원본 광고와 교체 시안"})).toHaveCount(0);
  await page.getByRole("button",{name:"디자인 견본으로 돌아가기"}).click();
  const example = page.getByRole("button",{name:"짧은 문장 포스터",exact:true});
  await expect(example.getByText("구성 예시",{exact:true})).toBeVisible();
  await example.click();
  await expect(example).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("button",{name:"카피 작성하기",exact:true})).toBeEnabled();
});

test("반응·성과에서 광고를 통해 이미지 광고와 A/B 프로젝트를 연다", async ({page}) => {
  await page.goto("/automation/performance");
  const group = page.getByRole("button", {name:"광고", exact:true});
  await expect(group).toBeVisible();
  if (await group.getAttribute("aria-expanded") === "false") await group.click();
  await page.locator('[data-stage="yt-ad"], [data-stage="ads"]').getByRole("link", {name:"이미지 광고", exact:true}).click();
  await expect(page.getByRole("navigation", {name:"현재 위치"}).getByRole("link", {name:"광고"})).toBeVisible();
  await page.getByRole("button", {name:"여러 안 테스트하기", exact:true}).click();
  await expect(page.getByRole("heading", {name:"A/B 테스트 프로젝트", exact:true})).toBeVisible();
  await expect(page.locator('[data-stage="yt-ad"] a.page-link[aria-current="page"], [data-stage="ads"] a.page-link[aria-current="page"]')).toHaveText("이미지 광고");
});

test("첫 화면은 모바일에서도 한 장 제작과 여러 안 테스트를 바로 시작할 수 있다", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/content/images");
  for (const title of ["광고 한 장 만들기", "여러 안 테스트하기"]) {
    const button = page.getByRole("button", {name:title, exact:true});
    await expect(button).toBeInViewport();
  }
  await expect(page.getByRole("region",{name:"광고 디자인 고르기"})).toHaveCount(0);
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
  await review.getByRole("button",{name:"수정하기",exact:true}).click();
  const editor=page.getByRole("region",{name:"디자인 편집",exact:true});
  await editor.getByRole("button",{name:"글꼴 · 크기 직접 조절",exact:true}).click();
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

test("새 WebP 원본 전체를 이미지 AI 입력으로 보관하고 상품 자료와 카피 초안을 다시 연다", async ({page})=>{
  const generationRequests:string[]=[];
  await page.route("**/reference-generate",route=>{generationRequests.push(route.request().url());return route.abort();});
  await page.goto("/content/images");
  await page.getByRole("button",{name:"광고 한 장 만들기",exact:true}).click();
  await page.getByRole("combobox",{name:"상품 선택",exact:true}).selectOption("__demo");
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await page.getByLabel("소구점 직접 작성",{exact:true}).fill("직접 만든 컵을 선물하기");
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await page.getByRole("button",{name:"새 레퍼런스 이미지 사용"}).click();
  const original=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=240;canvas.height=240;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle="#f6e4b9";ctx.fillRect(0,0,240,240);
    ctx.fillStyle="#593f32";ctx.font="bold 20px sans-serif";ctx.fillText("SAMPLE",20,44);
    ctx.fillStyle="#0000ff";ctx.fillRect(235,0,5,240);
    return canvas.toDataURL("image/webp").split(",")[1];
  });
  await page.getByLabel("레퍼런스 원본 올리기").setInputFiles({name:"sample.webp",mimeType:"image/webp",buffer:Buffer.from(original,"base64")});
  await expect(page.getByAltText("AI에 전달할 레퍼런스 원본 전체")).toBeVisible();
  await expect(page.getByRole("combobox",{name:"구도",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"원본의 교체 영역 편집"})).toHaveCount(0);
  await expect(page.getByRole("combobox",{name:"출력 규격"})).toHaveValue("square");
  await page.getByText("상품 이미지 추가 (선택)",{exact:true}).click();
  await page.getByLabel("상품 이미지 올리기").setInputFiles("public/image-format-test/master.jpg");
  await expect(page.getByRole("radio",{name:"이미지 2",exact:true})).toBeChecked();
  await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
  await page.getByLabel("제목",{exact:true}).fill("직접 빚은 컵");
  await page.getByLabel("버튼 문구",{exact:true}).fill("수업 살펴보기");
  await page.getByRole("button",{name:"초안 저장",exact:true}).click();
  await expect(page.getByText("초안 저장됨 · 카피 승인 대기",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("제목",{exact:true})).toHaveValue("직접 빚은 컵");
  await expect(page.getByLabel("버튼 문구",{exact:true})).toHaveValue("수업 살펴보기");
  await expect(page.getByAltText("선택한 원본 디자인")).toBeVisible();
  await expect(page.getByRole("group",{name:"원본 광고와 교체 시안"})).toHaveCount(0);
  const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
  const request=draft.state.formatApproval.request;
  expect(request.formatIds).toEqual(["reference_image"]);expect(request.size).toBe("square");
  expect(request.referenceLayout).toMatchObject({reproduction:"image-ai",source:{w:240,h:240}});
  expect(request.referenceLayout.master).toBeUndefined();expect(request.referenceLayout.composition).toBeUndefined();
  expect(request.referenceLayout.source.path).toMatch(/\.png$/);
  expect(request.assetPaths).toEqual([draft.assets[1].path]);
  expect(request.assetPaths[0]).not.toBe(request.referenceLayout.source.path);
  expect(draft.state.batches).toHaveLength(0);expect(draft.jobs).toHaveLength(0);expect(generationRequests).toHaveLength(0);
  const fullOriginal=await page.evaluate(async ({original,stored})=>{
    async function pixels(src:string) {
      const img=new Image();img.src=src;await img.decode();
      const canvas=document.createElement("canvas");canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const ctx=canvas.getContext("2d")!;ctx.drawImage(img,0,0);
      return canvas.toDataURL("image/png");
    }
    return (await pixels("data:image/webp;base64,"+original))===(await pixels(stored));
  },{original,stored:draft.assets[0].url});
  expect(fullOriginal).toBe(true);
  await page.getByRole("button",{name:"레퍼런스 변경"}).click();
  await page.getByText("상품 이미지 추가 (선택)",{exact:true}).click();
  await expect(page.getByRole("radio",{name:"이미지 2",exact:true})).toBeChecked();
  await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
  await page.getByRole("button",{name:"카피 확정 · 시안 만들기로",exact:true}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
  expect(stored.state.batches[0].review.copy).toBeTruthy();
  expect(stored.state.variants[0].asset.path).toBe(request.assetPaths[0]);
  expect(stored.state.variants[0].referenceLayout).toEqual(request.referenceLayout);
  expect(stored.state.variants[0].referenceArtwork).toBeUndefined();
  expect(generationRequests).toHaveLength(0);
});

for (const source of ["직접 업로드", "창고 보관본"] as const) {
  test(`${source} 레퍼런스 원본을 보며 카피 초안을 저장하고 승인 전에는 이미지를 만들지 않는다`, async ({page}) => {
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
    await expect(page.getByAltText("AI에 전달할 레퍼런스 원본 전체")).toBeVisible();
    await expect(page.getByRole("combobox",{name:"구도",exact:true})).toHaveCount(0);
    await expect(page.getByRole("combobox",{name:"편집할 영역"})).toHaveCount(0);
    const writeCopy=page.getByRole("button",{name:"카피 작성하기",exact:true});
    await expect(writeCopy).toBeEnabled();
    await page.getByText("상품 이미지 추가 (선택)",{exact:true}).click();
    await page.getByLabel("상품 이미지 올리기").setInputFiles("public/image-format-test/thumbnail-subject.jpg");
    await writeCopy.click();

    await expect(page.getByAltText("선택한 원본 디자인")).toBeVisible();
    await expect(page.getByRole("group",{name:"원본 광고와 교체 시안"})).toHaveCount(0);
    await page.getByLabel("제목",{exact:true}).fill("나만의 컵");
    await page.getByLabel("본문",{exact:true}).fill("공방에서 만나요");
    await page.getByLabel("버튼 문구",{exact:true}).fill("신청하기");
    await page.getByRole("button",{name:"초안 저장",exact:true}).click();
    await expect(page.getByText("초안 저장됨 · 카피 승인 대기")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("제목",{exact:true})).toHaveValue("나만의 컵");
    await expect(page.getByAltText("선택한 원본 디자인")).toBeVisible();
    const bundle=await page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
    const layout=bundle.state.formatApproval.request.referenceLayout;
    expect(layout.reproduction).toBe("image-ai");
    expect(layout.master).toBeUndefined();expect(layout.composition).toBeUndefined();
    expect(bundle.state.formatApproval.request.assetPaths).toEqual([bundle.assets[1].path]);
    expect(bundle.state.formatApproval.copyDraft[0].headline).toBe("나만의 컵");
    expect(bundle.state.batches).toHaveLength(0);
    expect(bundle.jobs).toHaveLength(0);
  });
}

test("레퍼런스 창고에서 카드를 골라 시작하면 원본 전체를 이미지 AI 입력으로 준비하고, 돌아가면 창고가 다시 보인다", async ({page}) => {
  const card = {keep:"구도를 유지하세요.",slots:"문구",source:"",version:1,documentId:""};
  const samples = [{...card,id:"R01",name:"첫 묶음 원본",group:"대표 선택 18종",thumbnail:"/image-format-test/master.jpg"},
    {...card,id:"R02",name:"이미지 없는 원본",group:"대표 선택 18종",thumbnail:""},
    {...card,id:"D01",name:"다른 묶음 원본",group:"비교·순서·도식",thumbnail:"/image-format-test/master.jpg"}];
  await page.route(/\/api\/(dev\/image-ad-references|v1\/content\/image-creatives\/references(?:\/examples)?)$/,route=>route.fulfill({json:{entries:samples}}));
  await page.goto("/content/images");
  await page.getByRole("button",{name:"광고 한 장 만들기",exact:true}).click();
  const products=page.getByRole("combobox",{name:"상품 선택",exact:true});
  const sample=products.locator('option[value="__demo"], option[value="myin-free"]').first();
  await expect(sample).toBeAttached();
  await products.selectOption((await sample.getAttribute("value"))!);
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await page.getByLabel("소구점 직접 작성",{exact:true}).fill("직접 만든 컵을 선물하기");
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"레퍼런스 창고에서 고르기",exact:true})).toBeVisible();
  const cards=page.locator('[aria-label="레퍼런스 창고"] article');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).getByText("원본 이미지 등록 필요")).toBeVisible();
  await expect(page.getByRole("button",{name:"이 디자인으로 시작하기"})).toHaveCount(0);
  await page.getByLabel("레퍼런스 검색").fill("다른 묶음");
  await expect(cards).toHaveCount(1);
  await expect(page.getByLabel("묶음")).toBeDisabled();
  await page.getByLabel("레퍼런스 검색").fill("");
  await cards.first().locator("button.ic-flow-reference-choice").click();
  await page.getByRole("button",{name:"이 디자인으로 시작하기"}).click();
  await expect(page.getByAltText("AI에 전달할 레퍼런스 원본 전체")).toBeVisible();
  await expect(page.getByRole("heading",{name:"레퍼런스 창고에서 고르기",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"디자인 견본으로 돌아가기"}).click();
  await expect(page.getByRole("heading",{name:"레퍼런스 창고에서 고르기",exact:true})).toBeVisible();
});

test("레퍼런스 AI 시안은 사진 없이 카피를 확정하고 실제 생성 전에는 미리보기를 승인할 수 없다", async ({page})=>{
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
    const canvas=document.createElement("canvas");canvas.width=240;canvas.height=240;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle="#f6e4b9";ctx.fillRect(0,0,240,300);
    ctx.fillStyle="#593f32";ctx.font="bold 20px sans-serif";ctx.fillText("SAMPLE",20,44);
    return canvas.toDataURL("image/webp").split(",")[1];
  });
  await page.getByLabel("레퍼런스 원본 올리기").setInputFiles({name:"sample.webp",mimeType:"image/webp",buffer:Buffer.from(original,"base64")});
  await expect(page.getByAltText("AI에 전달할 레퍼런스 원본 전체")).toBeVisible();
  await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"카피 작성",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"공통 이미지를 먼저 선택해 주세요"})).toHaveCount(0);
  await page.getByLabel("제목",{exact:true}).fill("직접 빚은 컵");
  await page.getByLabel("버튼 문구",{exact:true}).fill("수업 살펴보기");
  await page.getByRole("button",{name:"카피 확정 · 시안 만들기로",exact:true}).click();
  await expect(page.getByRole("region",{name:"시안에 넣을 사진"})).toHaveCount(0);
  const group=page.getByRole("region",{name:"1번째 묶음 검토",exact:true});
  await expect(group.getByRole("button",{name:"수정하기",exact:true})).toBeDisabled();
  await expect(group.getByRole("button",{name:/미리보기 확인/})).toBeDisabled();
  await expect(group.getByRole("button",{name:"레퍼런스로 시안 만들기",exact:true})).toBeDisabled();
  await expect(group.getByText("개발 화면에서는 실제 AI 생성 결과를 불러온 경우에만 시안을 확인할 수 있어요.")).toBeVisible();
  await expect(group.locator(".ic-artboard img")).toHaveCount(0);
  await group.getByText("상품 자료 추가·변경 (선택)",{exact:true}).click();
  await group.getByLabel("사진 올리기").setInputFiles("public/image-format-test/master.jpg");
  await group.getByRole("button",{name:/이 사진 넣기/}).click();
  // An upload is input material, never an AI-generated ad or readiness proof.
  await expect(group.getByRole("button",{name:"수정하기",exact:true})).toBeDisabled();
  await expect(group.getByRole("button",{name:/미리보기 확인/})).toBeDisabled();
  await expect(group.locator(".ic-artboard img")).toHaveCount(0);
});

for (const legacyKind of ["composition","master"] as const) {
  test(`저장된 ${legacyKind} 초안은 읽기만으로 바뀌지 않고 명시 선택 뒤에도 카피와 상품 자료를 보존한다`,async({page})=>{
    const project={id:crypto.randomUUID(),title:"기존 레퍼런스 초안",version:7};
    const source={path:"demo/legacy-source.png",w:1080,h:1350,url:"/image-format-test/master.jpg"};
    const photo={path:"demo/legacy-product.png",w:1080,h:1350,url:"/image-format-test/thumbnail-subject.jpg"};
    const detail={path:"demo/legacy-detail.png",w:1080,h:1350,url:"/image-format-test/master.jpg"};
    const layout:ReferenceLayout={...draftReferenceLayout(source),...(legacyKind==="composition" ?
      {composition:{style:"split",background:"#eeddcc",ink:"#111111",accent:"#0055ee",imageSide:"end",fit:"contain"}} :
      {master:{v:1,background:"#eeddcc",regions:[],headlineWeight:900,detailSlots:[{x:10,y:45,w:80,h:18,crop:{x:0,y:0,w:100,h:100},source:"detail",fit:"contain"}]}})};
    const copy={headline:"내가 빚은 컵",body:"공방에서 만나요",cta:"예약하기"};
    let state=emptyImageCreative();
    state.brief={...state.brief,brand:"공방",product:"도예",audience:"입문자",offer:"컵 만들기",objective:"예약",funnel:"체험"};
    state.formatRecommendation=selectedReferencePlan(state.brief,"standalone","portrait",[{id:"cup",meaning:"직접 빚은 컵"}]);
    const request:ImageBatchRequest={mode:"standalone",count:1,size:"portrait",formatIds:["reference_image"],assetPaths:[photo.path],referenceLayout:layout,
      ...(legacyKind==="master"?{detailAssetPath:detail.path}:{})};
    state=saveReferenceCopyDraft(approveImageFormat(state,request,{at:"2026-11-17T01:00:00Z",by:"owner"}),[copy]);
    const seed={project,state,assets:[source,photo,...(legacyKind==="master"?[detail]:[])],jobs:[]};
    await page.addInitScript(bundle=>{if(!localStorage.getItem("os-image-creatives-demo-v1"))
      localStorage.setItem("os-image-creatives-demo-v1",JSON.stringify([bundle]));},seed);
    const readSaved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
    const generationRequests:string[]=[];
    await page.route("**/reference-generate",route=>{generationRequests.push(route.request().url());return route.abort();});
    await page.goto("/content/images?project="+project.id);
    await expect(page.getByRole("textbox",{name:"제목",exact:true})).toHaveValue(copy.headline);
    expect((await readSaved()).state).toEqual(state);
    await expect(page.getByRole("group",{name:"원본 광고와 교체 시안"})).toHaveCount(0);
    await page.getByRole("button",{name:"레퍼런스 변경",exact:true}).click();
    for(const name of ["구도","사진 맞춤","제목 굵기","사진 위치","바탕색","사진 비율","편집할 영역"])
      await expect(page.getByLabel(name,{exact:true})).toHaveCount(0);
    for(const name of ["원본의 교체 영역 편집","새 구도로 다시 배치","가릴 영역 추가","브랜드 칸 추가"])
      await expect(page.getByRole("button",{name,exact:true})).toHaveCount(0);
    expect((await readSaved()).state).toEqual(state);
    await page.reload();
    await expect(page.getByRole("textbox",{name:"제목",exact:true})).toHaveValue(copy.headline);
    expect((await readSaved()).state).toEqual(state);
    await page.getByRole("button",{name:"레퍼런스 변경",exact:true}).click();
    await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"제목",exact:true})).toHaveValue(copy.headline);
    await expect(page.getByRole("textbox",{name:"본문",exact:true})).toHaveValue(copy.body);
    await expect(page.getByRole("textbox",{name:"버튼 문구",exact:true})).toHaveValue(copy.cta);
    const continued=await readSaved();
    expect(continued.state.formatApproval.request.referenceLayout).toEqual(layout);
    expect(continued.state.formatApproval.request.referenceLayout.source).toEqual(layout.source);
    expect(continued.state.formatApproval.request.assetPaths).toEqual([photo.path]);
    if(legacyKind==="master") expect(continued.state.formatApproval.request.detailAssetPath).toBe(detail.path);
    expect(continued.state.formatApproval.copyDraft).toEqual([copy]);
    expect(continued.state).toEqual(seed.state);
    expect(continued.state.variants).toHaveLength(0);
    expect(continued.state.batches).toHaveLength(0);
    expect(continued.assets).toEqual(seed.assets);
    expect(generationRequests).toHaveLength(0);
    await page.getByRole("button",{name:"카피 확정 · 시안 만들기로",exact:true}).click();
    const group=page.getByRole("region",{name:"1번째 묶음 검토",exact:true});
    await expect(group.getByRole("region",{name:"레퍼런스 기반 시안 제작"})).toBeVisible();
    await expect(group.getByRole("button",{name:"레퍼런스로 시안 만들기",exact:true})).toBeDisabled();
    await expect(group.getByRole("button",{name:"수정하기",exact:true})).toBeDisabled();
    await expect(group.getByRole("button",{name:/미리보기 확인/})).toBeDisabled();
    await expect(group.locator(".ic-artboard img")).toHaveCount(0);
    const approvedCopy=await readSaved();
    expect(approvedCopy.state.variants[0].referenceLayout).toEqual(layout);
    expect(approvedCopy.state.variants[0].asset.path).toBe(photo.path);
    expect(approvedCopy.state.variants[0].referenceArtwork).toBeUndefined();
    expect(approvedCopy.state.batches[0].review.copy).toBeTruthy();
    expect(generationRequests).toHaveLength(0);
  });
}

test("기존 레퍼런스 완성본을 다시 보고 이전 단계를 열어도 출력과 승인 기록은 그대로다",async({page})=>{
  const project={id:crypto.randomUUID(),title:"기존 완성본",version:12};
  const source={path:"demo/completed-source.png",w:1080,h:1350,url:"/image-format-test/master.jpg"};
  const photo={path:"demo/completed-product.png",w:1080,h:1350,url:"/image-format-test/thumbnail-subject.jpg"};
  const layout:ReferenceLayout={...draftReferenceLayout(source),composition:{style:"split",background:"#eeddcc",ink:"#111111",accent:"#0055ee",imageSide:"end",fit:"contain"}};
  const copy={headline:"내가 빚은 컵",body:"공방에서 만나요",cta:"예약하기"};
  const stamp={at:"2026-11-17T01:00:00Z",by:"owner"},output={runId:"existing-output",target:"render-pc" as const};
  let state=emptyImageCreative();
  state.brief={...state.brief,brand:"공방",product:"도예",audience:"입문자",offer:"컵 만들기",objective:"예약",funnel:"체험"};
  state.formatRecommendation=selectedReferencePlan(state.brief,"standalone","portrait",[{id:"cup",meaning:"직접 빚은 컵"}]);
  const request:ImageBatchRequest={mode:"standalone",count:1,size:"portrait",formatIds:["reference_image"],assetPaths:[photo.path],referenceLayout:layout};
  state=approveImageFormat(state,request,stamp);
  state=startImageCopyBatch(state,createImageBatch(state,request,{copies:[copy]},{now:stamp.at,by:stamp.by,newId:()=>crypto.randomUUID(),assets:[photo]}),request);
  const batchId=state.batches[0].id;
  state=confirmReferenceCopy(state,batchId,[copy],stamp);
  state=reviewImageBatch(reviewImageBatch(state,batchId,"preview",stamp,output),batchId,"final",stamp,output);
  const seed={project,state,assets:[source,photo],jobs:[],renders:[{id:output.runId,target:"render-pc",status:"done",variantIds:state.batches[0].variantIds}]};
  await page.addInitScript(bundle=>{if(!localStorage.getItem("os-image-creatives-demo-v1"))
    localStorage.setItem("os-image-creatives-demo-v1",JSON.stringify([bundle]));},seed);
  const previews:unknown[]=[];
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWmsAAAAASUVORK5CYII=","base64");
  await page.route("**/reference-generate",()=>{throw new Error("Completed work must not be regenerated");});
  await page.route("**/preview",route=>{previews.push(route.request().postDataJSON().variant.referenceLayout);return route.fulfill({contentType:"image/png",body:png});});
  const readSaved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("os-image-creatives-demo-v1")!)[0]);
  await page.goto("/content/images?project="+project.id);
  const group=page.getByRole("region",{name:"1번째 묶음 검토",exact:true});
  await expect(group.getByText("최종 검수 완료",{exact:true})).toBeVisible();
  await expect(group.getByRole("button",{name:"내보내기",exact:true})).toBeEnabled();
  expect(previews.length).toBeGreaterThan(0);
  for(const value of previews) expect(value).toEqual(state.variants[0].referenceLayout);
  await page.getByRole("button",{name:"뒤로 · 카피 확인",exact:true}).click();
  await page.getByRole("button",{name:"뒤로 · 레퍼런스 확인",exact:true}).click();
  await expect(page.getByAltText("승인한 레퍼런스 원본")).toHaveAttribute("src",source.url);
  await expect(page.getByRole("button",{name:"원본의 교체 영역 편집",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"현재 시안으로 돌아가기",exact:true}).click();
  await page.reload();
  await expect(group.getByText("최종 검수 완료",{exact:true})).toBeVisible();
  const current=await readSaved();
  expect(current.state).toEqual(seed.state);expect(current.renders).toEqual(seed.renders);expect(current.assets).toEqual(seed.assets);
});

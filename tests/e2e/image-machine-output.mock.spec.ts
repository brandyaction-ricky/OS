import { selectedReferencePlan } from "../../lib/image-creative/direction";
import { getSharp } from "next/dist/server/image-optimizer";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { openWorkTools } from "./image-approval-steps";
import { expect, test, type Page } from "@playwright/test";
import { emptyImageCreative, createImageBatch, approveImageFormat, reviewImageBatch, startImageCopyBatch, confirmReferenceCopy, imageExperimentSummary, recordImageWinner, type ImageBatchRequest, type CreativeVariant } from "../../lib/image-creative/model";

// Run in a local non-demo server with NEXT_PUBLIC_SUPABASE_URL=https://image-ui-test.supabase.co
// and a fictional publishable key. The browser blocks every external network request.
test.skip(process.env.IMAGE_MACHINE_MOCK_E2E !== "true", "Requires the local mock-auth server.");

async function signInFixture(page: Page, owner: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") + "." +
    Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", exp: expires })).toString("base64url") + ".fixture";
  await page.addInitScript(({ owner, token, expires }) => {
    localStorage.setItem("sb-image-ui-test-auth-token", JSON.stringify({ access_token: token, refresh_token: "fixture", expires_at: expires,
      expires_in: 3600, token_type: "bearer", user: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test",
        app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
  }, { owner, token, expires });
}

test("요청한 Mac에서 출력한 파일만 내려받고 실패한 묶음은 다른 Mac으로 다시 보낸다", async ({ page }) => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const project = { id: "00000000-0000-4000-8000-000000000002", title: "테스트 광고", version: 4 };
  const imageId = "00000000-0000-4000-8000-000000000003";
  const batchId = "00000000-0000-4000-8000-000000000004";
  await signInFixture(page, owner);

  let state = emptyImageCreative();
  state.brief = { brand: "담시계", objective: "시계 만들기", audience: "직장인", offer: "직접 만든 시계", funnel: "예약", product: "수업", facts: "", landingUrl: "" };
  const poster: CreativeVariant = { id: imageId, at: "", by: "fixture", formatId: "typography", formatVersion: 1, size: "portrait",
    appeal: { id: "mine", meaning: "나만의 시계" }, copy: { headline: "시계를 만들어요", body: "시간을 담아요", cta: "예약하기" } };
  let renders: {id:string;target:string;status:string;variantIds:string[];reason?:string}[] = [];
  let reviewable: Record<string,string> = {};
  let rendered: Record<string, string> = {};
  const patchTargets: [string,string][] = [];
  const exports: string[] = [];
  const machineFile = "https://image-ui-test.supabase.co/storage/v1/object/sign/test/machine.png";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWmsAAAAASUVORK5CYII=", "base64");
  const stamp=()=>({by:"검수 담당자",at:new Date().toISOString()});
  const bundle = () => ({ project, state, assets: [], jobs: [], renders, rendered,reviewable });
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === "image-ui-test.supabase.co" && url.pathname === "/rest/v1/os_profiles")
      return route.fulfill({json: { id: owner, role: "admin", display_name: "테스트", email: "fixture@example.test", is_active:true }});
    if (req.url() === machineFile) return route.fulfill({contentType:"image/png",body:png});
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/v1/content/image-creatives") return route.fulfill({json:{projects: [project]}});
    if (url.pathname.endsWith("/myin")) return route.fulfill({json:{local:{state:"offline",ageSeconds:1200,engine:"unknown",job:null}}});
    if (url.pathname.endsWith("/preview")) return route.fulfill({contentType:"image/png",body:png});
    if (url.pathname.endsWith("/export")) {
      exports.push(url.search); return route.fulfill({json:{url:machineFile,name:"시계.png"}});
    }
    if (url.pathname.endsWith(project.id)) {
      if (req.method() === "PATCH") {
        const body = req.postDataJSON();
        patchTargets.push([body.action, body.target]);
        if (body.action === "approve-format") state=approveImageFormat(state,body.request,stamp());
        if (body.action === "import") {
          state=startImageCopyBatch(state,{...state, variants:[poster],batches:[{id:batchId,mode:"initial",count:1,
            formatIds:[poster.formatId],copyFields:[],variantIds:[poster.id],at:""}]},body.request);
        }
        if (body.action === "approve-copy") state=reviewImageBatch(state,batchId,"copy",stamp());
        if (body.action === "confirm-preview") {
          const id=crypto.randomUUID();
          renders=[...renders,{id,target:body.target,status:"queued",variantIds:[poster.id]}];
          state=reviewImageBatch(state,batchId,"preview",stamp(),{runId:id,target:body.target});
        }
        if(body.action==="approve-final") {
          state=reviewImageBatch(state,batchId,"final",stamp(),{runId:body.runId,target:"render-pc"});
          rendered={[poster.id]:machineFile};
        }
        project.version++;

      }
      return route.fulfill({json: bundle()});
    }
    return route.fulfill({json:{}});
  });

  await openWorkTools(page, "/content/images?project=" + project.id);
  const chooser = page.getByLabel("이미지를 출력할 컴퓨터");
  await expect(chooser).toHaveValue("render-pc");
  await chooser.selectOption("local");
  await expect(page.getByRole("button",{name:"내 AI에게 맡기기"})).toBeDisabled();
  await page.getByLabel("후보 수").fill("1");
  const field = page.getByRole("article").filter({has:page.getByRole("heading",{name:"짧은 문장 포스터",exact:true})});
  if (await field.count()) await field.getByRole("button",{name:"이 포맷 선택"}).click();
  else {await page.getByText("다른 포맷 보기",{exact:true}).click();await page.getByRole("button",{name:"짧은 문장 포스터",exact:true}).click();}
  await page.getByRole("button",{name:"포맷 승인",exact:true}).click();
  await page.getByRole("button", {name:"내 AI에게 맡기기"}).click();
  await expect(page.getByText(/구독 AI에 카피 후보를 요청했어요/)).toBeVisible();
  await page.getByText("구독 AI 결과 직접 가져오기", { exact:true }).click();
  await page.getByLabel("결과 JSON").fill(JSON.stringify({variants:[poster]}));
  await page.getByRole("button",{name:"결과 가져오기", exact:true}).click();
  const group=page.getByRole("region",{name:"1번째 묶음 검토"});
  await expect(group.getByText(poster.copy.body)).toBeVisible();
  await expect(group.getByText(poster.copy.cta)).toBeVisible();
  await expect(group.getByRole("img")).toHaveCount(0);
  await expect(group.getByRole("button",{name:"내보내기", exact:true})).toBeDisabled();
  expect(renders).toHaveLength(0);
  await group.getByRole("button",{name:"카피 승인",exact:true}).click();
  await expect(group.getByRole("img")).toBeVisible();
  expect(renders).toHaveLength(0);
  await group.getByRole("button",{name:"미리보기 확인 · 내 Mac에서 최종 출력"}).click();
  await expect(group.getByText("내 Mac · 출력 대기",{exact:true})).toBeVisible();
  await expect(group.getByRole("button",{name:"1번째 묶음 ZIP", exact:true})).toBeDisabled();
  renders[0]={...renders[0],status:"failed",reason:"컴퓨터에서 출력이 중단되었습니다."};
  await page.getByRole("button",{name:"상태 새로고침"}).click();
  await expect(group.getByText(/내 Mac · 출력 실패/)).toBeVisible();
  await chooser.selectOption("render-pc");
  await group.getByRole("button",{name:"미리보기 확인 · 공용 맥미니에서 최종 출력"}).click();
  await expect.poll(()=>patchTargets.at(-1)).toEqual(["confirm-preview","render-pc"]);
  renders[1]={...renders[1],status:"done"};
  reviewable={ [poster.id]:renders[1].id };
  await page.getByRole("button",{name:"상태 새로고침"}).click();
  await expect(group.getByRole("img",{name:poster.copy.headline})).toBeVisible();
  await expect(group.getByRole("button",{name:"내보내기",exact:true})).toBeDisabled();
  await group.getByRole("button",{name:"최종 검수 완료",exact:true}).click();
  await expect(group.getByRole("img",{name:poster.copy.headline})).toHaveAttribute("src",machineFile);
  await group.getByRole("button",{name:"내보내기",exact:true}).click();
  await expect.poll(()=>exports).toEqual(["?variantId="+imageId]);
  expect(patchTargets.map(([action])=>action)).toEqual(["approve-format","generate","import","approve-copy","confirm-preview","confirm-preview","approve-final"]);
});

test("기존 컨셉 프로젝트를 다시 열어 장면을 기획하고 카피 검토까지 이어간다", async ({page}, testInfo) => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const project = { id: "00000000-0000-4000-8000-000000000111", title: "", version: 1 };
  test.setTimeout(65_000);
  await page.setViewportSize({width:1440,height:960});
  const productCanon = {id:"00000000-0000-4000-8000-000000000113",title:"도자기 상품 목록",version:4};
  const why = "예약할 때 망설이는 이유를 한 문장으로 대조하기 좋습니다.";
  const stamp = { by: owner, at: "2026-11-10T03:00:00Z" };
  const headlines = ["나한테 딱 맞는 컵", "내 손으로 완성", "퇴근 후 손으로", "내가 만든 선물", "흙부터 배워 보기"];
  const meanings = ["기성품 대신 손에 맞는 머그컵을 직접 만들고 싶다.", "취미를 시작만 하고 그만둬서 이번엔 완성품을 남기고 싶다.", "온종일 화면을 보니 퇴근 후에는 손으로 흙을 만지고 싶다.", "늘 사 주던 선물 대신 직접 만든 컵을 건네고 싶다.", "도예를 취미로 삼기 전에 컵 하나를 만들며 적성에 맞는지 보고 싶다."];
  const customConcept = "주문할 때 고르는 손잡이와 직접 빚을 때의 손짓이 닮았다.";
  const photo = {path:`image-creatives/${project.id}/00000000-0000-4000-8000-000000000119.jpg`,w:720,h:900};
  const firstScene = "공방 입구 선반에서 작은 머그컵 손잡이에 손가락을 넣어본다.";
  const secondScene = "작업대에서 흙 한 줄을 자기 손가락 굵기에 맞춰 둥글게 빚는다.";
  let state = emptyImageCreative();
  let jobs: {id:string;status:string;phase:string}[] = [];
  const actions: string[] = [];
  project.title = "기존 도자기 광고 기획";
  state.experiment = true;
  state.brief = {product:"도자기 수업",audience:"퇴근 후 취미를 찾는 직장인",offer:"직접 만든 머그컵",brand:"산들공방",
    objective:"예약",funnel:"입문",facts:"",productSource:{productId:"mug",source:{id:productCanon.id,version:productCanon.version}}};
  state.formatRecommendation = {mode:"appeal",appealFirst:true,conceptFirst:true,count:5,size:"portrait",
    appeals:meanings.map((meaning,i)=>({id:"angle-"+i,meaning})),concepts:["손으로 고르는 크기에는 이유가 있다.","취향은 내가 고른 손잡이에 남는다."]};
  const bundle = () => ({ project, state, jobs, assets: [{...photo,url:"/image-format-test/master.jpg"}], renders: [], rendered: {}, reviewable: {} });
  await signInFixture(page, owner);
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === "image-ui-test.supabase.co" && url.pathname === "/rest/v1/os_profiles")
      return route.fulfill({json:{id:owner,role:"admin",display_name:"직원",email:"fixture@example.test",is_active:true}});
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/v1/content/image-creatives") {
      expect(req.method()).toBe("GET"); return route.fulfill({json:{projects:[project]}});
    }
    if (url.pathname.endsWith(project.id)) {
      if (req.method() === "PATCH") {
        const body = req.postDataJSON();
        actions.push(body.action);
        if (body.action === "plan-scene") {
          expect(body.direction).toEqual({concept:customConcept,medium:"photo"});
          const repeat=actions.filter(a=>a==="plan-scene").length>1;
          if(repeat) expect(body.replan).toBe(true);
          const plan=state.formatRecommendation!;
          plan.direction=body.direction;
          delete plan.scene;
          delete plan.items;
          jobs=[{id:repeat?"scene-2":"scene-1",phase:"formats",status:"active"}];
        } else if (body.action === "approve-and-generate") {
          expect(body.request).toMatchObject({mode:"appeal",count:5,formatIds:["photo_headline"],assetPaths:[photo.path]});
          state = approveImageFormat(state, body.request, stamp);
          jobs.unshift({id:"copy-job",phase:"copy",status:"backlog"});
        } else throw new Error("Unexpected action: " + body.action);
        project.version++;
      }
      return route.fulfill({json:bundle()});
    }
    return route.fulfill({json:{}});
  });
  await page.goto("/content/images?view=tests&project="+project.id);
  const angles = page.getByRole("heading",{name:"AI 소구점 제안 5개"});
  await expect(angles).toBeVisible();
  for (const text of meanings) await expect(page.getByText(text,{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"포맷 승인 · 카피 5개 만들기",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"카피 승인",exact:true})).toHaveCount(0);
  await page.locator("section").filter({has:angles}).screenshot({path:testInfo.outputPath("appeals.png")});
  await expect(page.getByRole("button",{name:"장면·포맷 기획하기"})).toBeDisabled();
  await page.getByRole("radio",{name:"직접 입력",exact:true}).check();
  await page.getByRole("textbox",{name:"내 광고 컨셉"}).fill(customConcept);
  await page.getByRole("radio",{name:"인물·상황 사진",exact:true}).check();
  await page.getByRole("button",{name:"장면·포맷 기획하기"}).click();
  await expect.poll(()=>actions.at(-1)).toBe("plan-scene");
  const finishScene = async (scene:string) => {
    const plan=state.formatRecommendation!;
    plan.scene=scene;
    plan.items=[{id:"photo_headline",reason:why},{id:"annotated",reason:"손이 닿은 부분에 작게 표시합니다."},{id:"thumbnail_subject",reason:"배경을 단순하게 하고 손과 머그컵을 크게 봅니다."}];
    jobs[0].status="done";
    project.version++;
    await page.reload();
    await expect(page.getByRole("heading",{name:"장면과 추천 포맷"})).toBeVisible();
    await expect(page.getByText(scene,{exact:true})).toBeVisible();
  };
  await finishScene(firstScene);
  await page.getByRole("button",{name:"같은 컨셉으로 새 장면 기획"}).click();
  await expect.poll(()=>actions.filter(a=>a==="plan-scene").length).toBe(2);
  await finishScene(secondScene);
  await expect(page.getByText(firstScene,{exact:true})).toHaveCount(0);
  const gallery=page.locator(".ic-format-choice-grid").first();
  const card=gallery.getByRole("button",{name:"사진 한 장 · 한 문장",exact:true});
  await expect(gallery.getByRole("img")).toHaveCount(3);
  await expect.poll(()=>card.getByRole("img").evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await gallery.screenshot({path:testInfo.outputPath("formats.png")});
  await card.click();
  await page.getByRole("radio",{name:"사진 1",exact:true}).check();
  await page.getByRole("button",{name:"포맷 승인 · 카피 5개 만들기",exact:true}).click();
  const expectedActions=["plan-scene","plan-scene","approve-and-generate"];
  await expect.poll(()=>actions).toEqual(expectedActions);
  const batchRequest = state.formatApproval!.request;
  const variants = meanings.map((meaning,i)=>({formatId:"photo_headline",formatVersion:1,size:"portrait",asset:photo,
    appeal:{id:"angle-"+i,meaning},copy:{headline:headlines[i],body:headlines[i]+" · 도자기 수업",cta:"수업 예약"}}));
  state = startImageCopyBatch(state, createImageBatch(state,batchRequest,{variants},{now:stamp.at,by:"fixture",newId:()=>crypto.randomUUID()}),batchRequest);
  jobs[0].status = "done";
  project.version++;
  await expect(page.getByRole("button",{name:"카피 승인",exact:true})).toBeVisible({timeout:22000});
  for (const {copy} of variants) await expect(page.getByText(copy.body,{exact:true})).toBeVisible();
  await expect(page.getByText("수업 예약",{exact:true})).toHaveCount(5);
  await page.getByRole("region",{name:"1번째 묶음 검토"}).screenshot({path:testInfo.outputPath("copy-review.png")});
  expect(actions).toEqual(expectedActions);
});

test("기존 단독 소재는 카피 대기열 장애 후 같은 작업과 사진으로 재개한다", async ({page})=>{
  test.setTimeout(100_000);
  const owner = "00000000-0000-4000-8000-000000000001";
  const id = "00000000-0000-4000-8000-000000000019";
  const photo = {path:`youtube/${id}/image-creative/00000000-0000-4000-8000-000000000029.jpg`,w:640,h:480,url:"/image-format-test/master.jpg"};
  const project = {id,title:"",version:1};
  let state = emptyImageCreative(), creates = 0, recommendations = 0, approvals = 0;
  const stamp = {by:owner,at:"2026-11-10T10:00:00Z"};
  let jobs: {id:string;status:string;phase:string;currentInput:boolean}[] = [];
  project.title = "이력 노트";
  state.brief={brand:"노트",objective:"첫 구매",audience:"입문자",funnel:"구매",product:"노트",offer:"노트 한 권",facts:"",mainMessage:"하루를 기록하세요"};
  state.formatRecommendation={mode:"standalone",count:1,size:"portrait"};
  const requestedPhotos: string[][] = [];
  const items = [{id:"photo_headline" as const,reason:"사진을 보며 소재를 확인해요."},{id:"question" as const,reason:"관심사를 물어봐요."},{id:"typography" as const,reason:"메시지만 강조해요."}];
  const bundle = ()=>({project,state,jobs,assets:[photo],renders:[],rendered:{},reviewable:{}});
  await signInFixture(page,owner);
  await page.route("**/*", async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.hostname==="image-ui-test.supabase.co" && url.pathname==="/rest/v1/os_profiles") return route.fulfill({json:{id:owner,role:"admin",display_name:"직원",is_active:true}});
    if(url.hostname!=="127.0.0.1")return route.abort();
    if(!url.pathname.startsWith("/api/"))return route.continue();
    if(url.pathname==="/api/v1/content/image-creatives/products"){
      return route.fulfill({json:{products:[]}});
    }
    if(url.pathname==="/api/v1/content/image-creatives"){
      if(req.method()==="POST"){creates++;const body=req.postDataJSON();project.title=body.title;state.brief=body.brief;return route.fulfill({json:bundle()});}
      return route.fulfill({json:{projects:project.title?[project]:[]}});
    }
    if(!url.pathname.endsWith(id))return route.fulfill({json:{}});
    if(req.method()!=="PATCH")return route.fulfill({json:bundle()});
    const body=req.postDataJSON();
    expect(body.version).toBe(project.version);
    project.version++;
    if(body.action==="recommend-formats") {
      recommendations++;
      state.brief=body.brief;
      state.formatRecommendation={mode:"standalone",count:1,size:"portrait"};
      if(recommendations===1 || recommendations===3){
        jobs=recommendations===1?[]:[{id:"superseded-plan",phase:"formats",status:"active",currentInput:false}];
        return route.fulfill({status:503,json:{error:{message:"대기열 연결 실패"}}});
      }
      state.formatRecommendation.items=items;
      jobs=[{id:"previous-plan",phase:"formats",status:"done",currentInput:false}];
    } else if(body.action==="approve-and-generate"){
      approvals++;
      requestedPhotos.push(body.request.assetPaths);
      if(approvals===1) {
        state.brief = {...state.brief,mainMessage:"다른 곳에서 수정한 메시지"};
        state.formatRecommendation={mode:"standalone",count:1,size:"portrait",items};
        return route.fulfill({status:409,json:{error:{message:"작업 기획이 바뀌었어요"}}});
      }
      state=approveImageFormat(state,body.request,stamp);
      jobs=[{id:"older-copy",phase:"copy",status:"backlog",currentInput:false}];
      return route.fulfill({status:503,json:{error:{message:"카피 대기열 연결 실패"}}});
    } else if(body.action==="generate"){
      expect(body.guided).toBe(true);
      requestedPhotos.push(body.request.assetPaths);
      jobs=[{id:"new-copy",phase:"copy",status:"backlog",currentInput:true}];
    } else throw new Error(body.action);
    return route.fulfill({json:bundle()});
  });
  await page.goto("/content/images?project="+id);
  await page.getByRole('button',{name:'추천 포맷 다시 요청하기'}).click();
  await expect(page.getByRole('alert').filter({hasText:"대기열 연결 실패"})).toBeVisible();
  await page.getByRole('button',{name:'추천 포맷 다시 요청하기'}).click();
  await page.getByRole('button',{name:'기획 수정'}).click();
  await page.getByLabel('메인 메시지').fill("보내지 않을 편집");
  await page.getByRole('button',{name:'뒤로',exact:true}).click();
  await expect(page.getByText("하루를 기록하세요",{exact:true})).toBeVisible();
  expect(recommendations).toBe(2);
  await page.getByRole('button',{name:'기획 수정'}).click();
  await page.getByLabel('메인 메시지').fill("이틀을 기록하세요");
  await page.getByRole('button',{name:'AI 포맷 추천받기'}).click();
  await page.getByRole('alert').filter({hasText:"대기열 연결 실패"}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'추천 포맷 다시 요청하기'}).click();
  await page.getByRole('button',{name:'사진 한 장 · 한 문장',exact:true}).click();
  await page.getByRole('radio',{name:'사진 1'}).check();
  const approveButton=page.getByRole('button',{name:'포맷 승인 · 카피 1개 만들기',exact:true});
  await approveButton.click();
  await expect(page.getByText('다른 곳에서 수정한 메시지',{exact:true})).toBeVisible();
  await expect(approveButton).toBeDisabled();
  await page.getByRole('button',{name:'사진 한 장 · 한 문장',exact:true}).click();
  await approveButton.click();
  await expect(page.getByRole('alert').filter({hasText:"카피 대기열 연결 실패"})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'카피 다시 요청하기'}).click();
  await expect(page.getByRole('heading',{name:'카피 요청이 대기 중이에요'})).toBeVisible();
  expect(creates).toBe(0);
  expect(recommendations).toBe(4);
  expect(requestedPhotos).toEqual([[photo.path],[photo.path],[photo.path]]);
});

test("A/B 목록에서 같은 프로젝트를 재개해 소구·카피·이미지 승자와 기존 승리 소재를 보존한다", async ({page}, testInfo)=>{
  const owner = crypto.randomUUID(), id = crypto.randomUUID();
  const stamp = {by:owner, at:"2026-11-11T04:00:00Z"};
  const product = "머그컵 만들기", project = {id,title:"겨울 머그컵 신규 고객",version:1};
  let state = emptyImageCreative();
  state.experiment = true;
  state.brief = {product,audience:"공예 초보",offer:"컵을 직접 빚는 한 번의 수업",brand:"모래공방",objective:"예약",funnel:"체험",facts:""};
  const photos = Array.from({length:3},()=>({path:`image-creatives/${id}/${crypto.randomUUID()}.jpg`,w:720,h:960}));
  const context = {by:"연결 시험", now:stamp.at, newId:()=>crypto.randomUUID()};
  const initial: ImageBatchRequest = {mode:"appeal",count:2,formatIds:["photo_headline"],size:"portrait",assetPaths:[photos[0].path]};
  const appeals = ["퇴근 후 손으로 흙 만지기","친구에게 직접 만든 선물"];
  const requests: ImageBatchRequest[] = [];
  function importAndReview(request:ImageBatchRequest, variants:unknown[]) {
    state=startImageCopyBatch(state,createImageBatch(state,request,{variants},context),request);
    const batch=state.batches.at(-1)!;
    const output={runId:crypto.randomUUID(),target:"local" as const};
    for(const step of ["copy","preview","final"] as const) state=reviewImageBatch(state,batch.id,step,stamp,output);
  }
  state=approveImageFormat(state,initial,stamp);
  importAndReview(initial,appeals.map((meaning,i)=>({formatId:"photo_headline",formatVersion:1,size:"portrait",asset:photos[0],
    appeal:{id:"reason-"+i,meaning},copy:{headline:meaning,body:"흙으로 빚는 컵 한 개",cta:"수업 예약"}})));
  const firstWinner=state.variants[1];
  // Render the fixtures with the same PNG renderer used by the production worker so the reopened control is visually identifiable.
  const { buildAdRuntime, renderAdPng } = await import(pathToFileURL(resolve("tools/image-ad-renderer.mjs")).href);
  const runtime = buildAdRuntime(process.cwd(),testInfo.outputPath("renderer"));
  const palette = [["#eedec4","#a23a21"],["#d8ece6","#126e68"],["#e8e0f0","#725193"]];
  const pictures = await Promise.all(palette.map(async ([paper,glaze])=>{
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><rect width="720" height="960" fill="${paper}"/><ellipse cx="345" cy="674" rx="217" ry="29" fill="#342514" opacity=".15"/><path d="M454 385h45c113 0 105 182-31 191" fill="none" stroke="${glaze}" stroke-width="36"/><path d="M165 329h335l-24 253q-8 78-147 78t-143-78Z" fill="${glaze}"/><ellipse cx="332" cy="329" rx="166" ry="38" fill="#fff9eb"/><ellipse cx="332" cy="330" rx="144" ry="23" fill="#6b432c"/></svg>`;
    return await getSharp(1)(Buffer.from(svg)).jpeg().toBuffer();
  }));
  const artwork = new Map<string,Buffer>();
  const bundle=()=>({project:{...project,experiment:imageExperimentSummary(state)},state,jobs:[],assets:photos.map((asset,i)=>({...asset,url:"/fixture-photo/"+i})),
    renders:state.batches.map(b=>({id:b.review!.final!.runId,target:"local",status:"done",variantIds:b.variantIds})),
    rendered:Object.fromEntries(state.variants.map(v=>[v.id,"/fixture-png/"+v.id])),reviewable:{}});
  await signInFixture(page,owner);
  await page.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==="image-ui-test.supabase.co" && url.pathname==="/rest/v1/os_profiles") return route.fulfill({json:{id:owner,role:"admin",display_name:"직원",is_active:true}});
    if(url.hostname!=="127.0.0.1") return route.abort();
    if(url.pathname.startsWith("/fixture-photo/")) return route.fulfill({contentType:"image/jpeg",body:pictures[Number(url.pathname.split("/").pop())]});
    if(url.pathname.startsWith("/fixture-png/")){
      const variant=state.variants.find(v=>v.id===url.pathname.split("/").pop())!;
      const photo=pictures[photos.findIndex(p=>p.path===variant.asset?.path)];
      if(!artwork.has(variant.id)) artwork.set(variant.id,await renderAdPng(runtime,variant,"data:image/jpeg;base64,"+photo.toString("base64")));
      return route.fulfill({contentType:"image/png",body:artwork.get(variant.id)});
    }
    if(!url.pathname.startsWith("/api/")) return route.continue();
    if(url.pathname==="/api/v1/content/image-creatives") {
      expect(req.method()).toBe("GET");
      return route.fulfill({json:{projects:[bundle().project,{id:crypto.randomUUID(),title:"단독 제작 상품",version:1}]}});
    }
    if(!url.pathname.endsWith(id)) return route.fulfill({json:{}});
    if(req.method()==="PATCH") {
      const body=req.postDataJSON();
      expect(body.version).toBe(project.version);
      if(body.action==="record-winner") state=recordImageWinner(state,body.batchId,body.variantId,body.note??"",stamp);
      else if(body.action==="approve-and-generate"){
        const request=body.request as ImageBatchRequest;
        state=approveImageFormat(state,request,stamp);
        requests.push(request);
        const changes=request.mode==="copy"?Array.from({length:request.count},(_,i)=>({copy:{headline:"선물을 빚어요 "+(i+1)}})):
          request.assetPaths!.map(path=>({asset:photos.find(p=>p.path===path)!}));
        importAndReview(request,changes);
      }else throw new Error("Unexpected update: "+body.action);
      project.version++;
    }
    return route.fulfill({json:bundle()});
  });
  await page.goto("/content/images");
  await page.getByRole("button",{name:"여러 안 테스트하기",exact:true}).click();
  const listed=page.getByRole("link",{name:new RegExp(project.title)});
  await expect(listed).toBeVisible();
  await expect(page.getByText("단독 제작 상품",{exact:true})).toHaveCount(0);
  await page.locator(".ic-page").screenshot({path:testInfo.outputPath("ab-list.png")});
  await listed.click();
  await expect(page.getByRole("button",{name:"카피 테스트 시작",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"승리 소재로 지정",exact:true}).nth(1).click();
  await expect.poll(()=>state.batches[0].winner?.variantId).toBe(firstWinner.id);
  await page.locator(".ic-page").screenshot({path:testInfo.outputPath("ab-winner.png")});
  await page.getByRole("button",{name:"프로젝트 목록",exact:true}).click();
  await page.reload();
  await listed.click();
  await page.getByRole("button",{name:"카피 테스트 시작",exact:true}).click();
  await page.getByRole("spinbutton",{name:"후보 수"}).fill("2");
  await page.getByRole("button",{name:/포맷 승인 · 후보 2개 만들기/}).click();
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0].baseId).toBe(firstWinner.id);
  for(const v of state.variants.slice(-2)) {
    expect(v.parentId).toBe(firstWinner.id);expect(v.asset).toEqual(firstWinner.asset);
    expect(v.appeal).toEqual(firstWinner.appeal);expect(v.copy.body).toBe(firstWinner.copy.body);expect(v.copy.cta).toBe(firstWinner.copy.cta);
  }
  await page.getByRole("button",{name:"기존 소재 승리로 기록",exact:true}).click();
  await expect.poll(()=>state.batches[1].winner?.variantId).toBe(firstWinner.id);
  await page.reload();
  await page.getByRole("button",{name:"이미지 테스트 시작",exact:true}).click();
  await page.getByRole("checkbox",{name:"사진 2"}).check();
  await page.getByRole("checkbox",{name:"사진 3"}).check();
  await page.getByRole("button",{name:"이미지 후보 2개 만들기",exact:true}).click();
  await expect.poll(()=>requests.length).toBe(2);
  expect(requests[1].baseId).toBe(firstWinner.id);
  for(const v of state.variants.slice(-2)) {
    expect(v.copy).toEqual(firstWinner.copy);expect(v.appeal).toEqual(firstWinner.appeal);
    expect(v.formatId).toBe(firstWinner.formatId);expect(v.asset!.path).not.toBe(firstWinner.asset!.path);
  }
  await page.getByRole("button",{name:"승리 소재로 지정",exact:true}).last().click();
  await expect.poll(()=>imageExperimentSummary(state)?.status).toBe("complete");
  await page.getByRole("button",{name:"프로젝트 목록",exact:true}).click();
  await page.reload();
  await listed.click();
  expect(state.batches.map(b=>b.winner?.variantId)).toEqual([firstWinner.id,firstWinner.id,state.variants.at(-1)!.id]);
  const displayed=page.locator('img[src="/fixture-png/'+state.variants.at(-1)!.id+'"]').first();
  await expect.poll(()=>displayed.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBe(1080);
  expect(artwork.get(state.variants.at(-1)!.id)?.equals(artwork.get(firstWinner.id)!)).toBe(false);
  await page.locator(".ic-page").screenshot({path:testInfo.outputPath("ab-results.png")});
});

test("A/B 프로젝트에서 추천 소구점을 직접 골라 공통 레퍼런스와 카피를 저장한다",async ({page})=>{
  const owner=crypto.randomUUID(), project={id:crypto.randomUUID(),title:"",version:1};
  const product={id:"mug",product:"도자기 수업",brand:"공방",audience:"도예 입문자",offer:"직접 빚은 컵 한 개",objective:"수업 예약",funnel:"예약",
    source:{id:crypto.randomUUID(),title:"수업 안내",version:1}};
  let currentProduct=product;
  const options=["퇴근 후 흙을 만지며 쉰다","친구와 컵을 만든다","손에 맞는 컵을 만든다","직접 만든 선물","취미부터 체험한다"].map((meaning,i)=>({id:"angle-"+i,meaning}));
  const stamp={by:owner,at:"2026-11-12T04:00:00Z"}, actions:string[]=[];
  let state=emptyImageCreative();
  const bundle=()=>({project,state,jobs:[],assets:[],renders:[],reviewable:{},rendered:{}});
  await signInFixture(page,owner);
  await page.route("**/*",async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.hostname==="image-ui-test.supabase.co" && url.pathname==="/rest/v1/os_profiles")
      return route.fulfill({json:{id:owner,role:"admin",display_name:"직원",is_active:true}});
    if(url.hostname!=="127.0.0.1")return route.abort();
    if(!url.pathname.startsWith("/api/"))return route.continue();
    if(url.pathname.endsWith("/image-creatives/products"))return route.fulfill({json:{products:[currentProduct]}});
    if(url.pathname.endsWith("/image-creatives")){
      if(req.method()==="POST"){
        const body=req.postDataJSON();
        expect(body.experiment).toBe(true);
        if(currentProduct===product){
          currentProduct={...product,offer:"직접 빚은 컵과 작품 수령 안내",source:{...product.source,version:2}};
          return route.fulfill({status:409,json:{error:{code:"IMAGE_PRODUCT_CHANGED",message:"상품 정본을 다시 선택해 주세요."}}});
        }
        expect(body.brief.productSource.source.version).toBe(2);
        state.experiment=true; state.brief=body.brief; project.title=body.title; actions.push("create");
        return route.fulfill({json:bundle()});
      }
      return route.fulfill({json:{projects:project.title?[project]:[]}});
    }
    if(!url.pathname.endsWith("/"+project.id))return route.fulfill({json:{}});
    if(req.method()==="PATCH"){
      const body=req.postDataJSON(); actions.push(body.action);
      expect(body.version).toBe(project.version);
      switch (body.action) {
        case "recommend-appeals":
          expect(body).toMatchObject({mode:"appeal",count:5,brief:{product:product.product,audience:product.audience,offer:currentProduct.offer}});
          state.formatRecommendation={mode:"appeal",size:"portrait",count:5,referenceFirst:true,appealFirst:true,appealOptions:options};
          break;
        case "select-appeals":
          expect(body.appeals).toHaveLength(2);
          state.formatRecommendation=selectedReferencePlan(body.brief,body.mode,body.size,body.appeals,options);
          break;
        case "approve-format":
          expect(body.request).toMatchObject({mode:"appeal",count:2,formatIds:["typography"]});
          state=approveImageFormat(state,body.request,stamp);
          break;
        case "import":
          state=startImageCopyBatch(state,createImageBatch(state,body.request,body.result,{now:stamp.at,by:owner,newId:()=>crypto.randomUUID()}),body.request);
          break;
        case "confirm-reference-copy":
          state=confirmReferenceCopy(state,body.batchId,body.copies,stamp);
          break;
        default: throw new Error("Unexpected action: "+body.action);
      }
      project.version++;
    }
    return route.fulfill({json:bundle()});
  });
  await page.goto("/content/images?view=tests");
  await page.getByRole("button",{name:"새 테스트 프로젝트",exact:true}).click();
  await page.getByRole("combobox",{name:"상품 선택",exact:true}).selectOption("mug");
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  expect(actions.filter(v=>v==="recommend-appeals")).toHaveLength(0);
  await page.getByRole("button",{name:"AI에게 추천받기",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"상품 정본"})).toBeVisible();
  if (!(await page.getByRole("heading",{name:"상품 선택",exact:true}).isVisible())) {
    await page.getByRole("button",{name:"상품 변경",exact:true}).click();
  }
  await page.getByRole("button",{name:"최신 정본 적용",exact:true}).click();
  await expect(page.getByText(currentProduct.offer,{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await page.getByRole("button",{name:"AI에게 추천받기",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:options[0].meaning,exact:true})).toBeVisible();
  for (const [index,option] of options.entries())
    await page.getByRole("checkbox",{name:option.meaning,exact:true}).setChecked(index<2);
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await page.reload();
  const card=page.getByRole("button",{name:"짧은 문장 포스터",exact:true});
  await card.click();
  await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"카피 작성",exact:true})).toBeVisible();
  const headlines=["퇴근 후 흙 한 줌","함께 빚는 컵 한 쌍"];
  for (const [index,title] of headlines.entries()){
    const entry = page.getByRole("group",{name:options[index].meaning,exact:true});
    await entry.getByRole("textbox",{name:"제목",exact:true}).fill(title);
    await entry.getByRole("textbox",{name:"본문",exact:true}).fill("한 시간 도자기 수업");
  }
  await page.getByLabel("버튼 문구",{exact:true}).fill("예약하기");
  await page.getByRole("button",{name:"카피 확정 · 디자인 수정하기",exact:true}).click();
  const group=page.getByRole("region",{name:"1번째 묶음 검토",exact:true});
  await expect(group.getByRole("heading",{name:headlines[0],exact:true})).toBeVisible();
  expect(actions.filter(action=>action!=="create")).toEqual(["recommend-appeals","select-appeals","approve-format","import","confirm-reference-copy"]);
  expect(state.variants.map(v=>v.appeal)).toEqual(options.slice(0,2));
  expect(state.variants.map(v=>v.copy.headline)).toEqual(headlines);
  expect(state.variants.every(v=>v.formatId==="typography" && v.copy.cta==="예약하기")).toBe(true);
  expect(state.batches[0].review?.final).toBeUndefined();
});

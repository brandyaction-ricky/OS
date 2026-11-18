import { expect, test, type Page } from "@playwright/test";
import { getSharp } from "next/dist/server/image-optimizer";
import { approveImageFormat, confirmReferenceCopy, createImageBatch, emptyImageCreative, reviewImageBatch, startImageCopyBatch, type ImageBatchRequest } from "../../lib/image-creative/model";
import { selectedReferencePlan } from "../../lib/image-creative/direction";
import { draftReferenceLayout } from "../../lib/image-creative/reference-layout";
import type { ImageProjectBundle } from "../../components/image-creative-workspace";

// This verifies the real OS UI with mock API responses, not AI design quality or a physical Mac render.
// Start a local non-demo server with fictional image-ui-test Supabase settings. All external requests are blocked.
test.skip(process.env.IMAGE_MACHINE_MOCK_E2E !== "true", "Requires the local mock-auth server.");
async function signInFixture(page:Page, owner:string) {
  const expires=Math.floor(Date.now()/1000)+3600;
  const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")+"."+
    Buffer.from(JSON.stringify({sub:owner,role:"authenticated",exp:expires})).toString("base64url")+".fixture";
  await page.addInitScript(({owner,token,expires})=>{
    localStorage.setItem("sb-image-ui-test-auth-token",JSON.stringify({access_token:token,refresh_token:"fixture",expires_at:expires,
      expires_in:3600,token_type:"bearer",user:{id:owner,aud:"authenticated",role:"authenticated",email:"fixture@example.test",
        app_metadata:{provider:"email"},user_metadata:{},created_at:"2026-01-01T00:00:00Z"}}));
  },{owner,token,expires});
}

test("원본을 넣은 AI 시안 생성은 실패 후 자동 재시도하지 않고 저장 PNG를 검토해 Mac 최종 출력으로 잇는다",async({page},testInfo)=>{
  const owner=crypto.randomUUID(), project={id:crypto.randomUUID(),title:"레퍼런스 생성 흐름 시험",version:4};
  const stamp={by:owner,at:"2026-11-17T01:00:00Z"};
  const source={path:`image-creatives/${project.id}/${crypto.randomUUID()}.png`,w:1080,h:1080,url:"/fixture-reference.png"};
  const layout={...draftReferenceLayout(source),reproduction:"image-ai" as const};
  const copies=[{headline:"내게 맞는 일은 뭘까?",body:"내 강점 보고서에서 확인하세요.",cta:"내 강점 확인하기"},
    {headline:"아직 모르는 강점은 뭘까?",body:"내 강점 보고서에서 확인하세요.",cta:"내 강점 확인하기"}];
  let state=emptyImageCreative();
  state.brief={brand:"시험 브랜드",product:"진단",offer:"결과 보고서",audience:"직장인",objective:"무료 진단",funnel:"무료",facts:""};
  state.formatRecommendation=selectedReferencePlan(state.brief,"appeal","square",[{id:"a",meaning:"맞는 일"},{id:"b",meaning:"숨겨진 강점"}]);
  const request:ImageBatchRequest={mode:"appeal",count:2,size:"square",formatIds:["reference_image"],referenceLayout:layout};
  state=approveImageFormat(state,request,stamp);
  state=startImageCopyBatch(state,createImageBatch(state,request,{copies},{now:stamp.at,by:owner,newId:()=>crypto.randomUUID()}),request);
  const batchId=state.batches[0].id, ids=state.batches[0].variantIds;
  state=confirmReferenceCopy(state,batchId,copies,stamp);
  const sharp=getSharp(undefined);
  const original=await sharp({create:{width:1080,height:1080,channels:3,background:"#074784"}}).png().toBuffer();
  const generated=await sharp({create:{width:1080,height:1080,channels:3,background:"#084882"}}).png().toBuffer();
  let assets:ImageProjectBundle["assets"]=[source];
  let referenceRun:ImageProjectBundle["referenceRun"];
  let renders:NonNullable<ImageProjectBundle["renders"]>=[];
  let reviewable:Record<string,string>={},rendered:Record<string,string>={};
  const generateCalls:Array<{version:number;variantId:string}>=[], previewCalls:string[]=[], finalReads:string[]=[], exports:string[]=[];
  let inFlight=0,maxInFlight=0;
  const bundle=():ImageProjectBundle=>({project,state,assets,jobs:[],renders,rendered,reviewable,referenceRun});
  await signInFixture(page,owner);
  await page.clock.install();
  await page.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==="image-ui-test.supabase.co" && url.pathname==="/rest/v1/os_profiles")
      return route.fulfill({json:{id:owner,role:"admin",display_name:"시험 담당자",is_active:true}});
    if(url.hostname!=="127.0.0.1") return route.abort();
    if(url.pathname==="/fixture-reference.png") return route.fulfill({contentType:"image/png",body:original});
    if(url.pathname.startsWith("/fixture-artwork-") || url.pathname.startsWith("/fixture-final-")) return route.fulfill({contentType:"image/png",body:generated});
    if(!url.pathname.startsWith("/api/")) return route.continue();
    if(url.pathname==="/api/v1/content/image-creatives") return route.fulfill({json:{projects:[project]}});
    if(url.pathname.endsWith("/myin")) return route.fulfill({json:{local:{state:"offline",ageSeconds:1200,engine:"unknown",job:null}}});
    if(url.pathname.endsWith("/reference-generate")) {
      expect(req.method()).toBe("POST");
      const body=req.postDataJSON();
      expect(body).toEqual({version:project.version,variantId:generateCalls.length<2?ids[0]:ids[1]});
      expect(state.variants.every(v=>!v.asset)).toBe(true); // product photo is genuinely optional
      generateCalls.push(body); inFlight++; maxInFlight=Math.max(maxInFlight,inFlight);
      referenceRun={id:crypto.randomUUID(),variantId:body.variantId,inputHash:"a".repeat(64),status:"active",expiresAt:Date.now()+600_000};
      project.version++;
      if(generateCalls.length===1) {
        referenceRun={...referenceRun,status:"failed",failure:"PROVIDER_FIXTURE_FAILURE"};project.version++;inFlight--;
        return route.fulfill({status:503,json:{error:{code:"PROVIDER_FIXTURE_FAILURE",message:"시험용 생성 중단"}}});
      }
      const image={path:`image-creatives/${project.id}/${body.variantId}.png`,w:1080,h:1080};
      assets=[...assets,{...image,url:`/fixture-artwork-${body.variantId}.png`}];
      state={...state,variants:state.variants.map(v=>v.id===body.variantId?{...v,referenceArtwork:{image,model:"mock-image-result",inputHash:"a".repeat(64)}}:v)};
      project.version+=2;referenceRun={...referenceRun,status:"done"};inFlight--;
      return route.fulfill({json:bundle()});
    }
    if(url.pathname.endsWith("/preview")) {
      if(req.method()==="POST") {
        const {variantId}=req.postDataJSON();previewCalls.push(variantId);
        expect(state.variants.find(v=>v.id===variantId)?.referenceArtwork).toBeTruthy();
      } else {
        finalReads.push(url.search);
        expect(url.searchParams.get("runId")).toBe(renders[0].id);
      }
      return route.fulfill({contentType:"image/png",body:generated});
    }
    if(url.pathname.endsWith("/export")) {
      exports.push(url.search);
      expect(state.batches[0].review?.final).toBeTruthy();
      return route.fulfill({json:{url:`/fixture-final-${ids[0]}.png`,name:"verified.png"}});
    }
    if(url.pathname.endsWith(project.id)) {
      if(req.method()==="PATCH") {
        const body=req.postDataJSON();expect(body.version).toBe(project.version);
        if(body.action==="confirm-preview") {
          expect(body.target).toBe("render-pc");
          const runId=crypto.randomUUID();renders=[{id:runId,target:"render-pc",status:"queued",variantIds:ids}];
          state=reviewImageBatch(state,batchId,"preview",stamp,{runId,target:"render-pc"});
        } else if(body.action==="approve-final") {
          state=reviewImageBatch(state,batchId,"final",stamp,{runId:body.runId,target:"render-pc"});
          rendered=Object.fromEntries(ids.map(id=>[id,`/fixture-final-${id}.png`]));
        } else throw new Error("Unexpected mutation: "+body.action);
        project.version++;
      }
      return route.fulfill({json:bundle()});
    }
    return route.fulfill({json:{}});
  });
  await page.goto("/content/images?project="+project.id);
  const group=page.getByRole("region",{name:"1번째 묶음 검토"});
  await expect(group.getByRole("img",{name:"선택한 레퍼런스 원본 전체"})).toHaveAttribute("src",source.url);
  await expect(group.getByText("시안에 넣을 사진을 골라 주세요")).toHaveCount(0);
  await expect(group.locator(".ic-artboard img")).toHaveCount(0);
  expect(previewCalls).toHaveLength(0);
  const preview=group.getByRole("button",{name:"미리보기 확인 · 공용 맥미니에서 최종 출력"});
  await expect(preview).toBeDisabled();
  await group.getByRole("button",{name:"레퍼런스로 시안 만들기",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"시험용 생성 중단"})).toBeVisible();
  await expect(group.getByRole("button",{name:"남은 시안 다시 만들기"})).toBeEnabled();
  await page.clock.fastForward(30_000);
  expect(generateCalls).toHaveLength(1);
  await page.reload();
  await expect(group.getByRole("button",{name:"남은 시안 다시 만들기"})).toBeEnabled();
  expect(generateCalls).toHaveLength(1);
  await group.getByRole("button",{name:"남은 시안 다시 만들기"}).click();
  await expect(preview).toBeEnabled();
  expect(generateCalls.map(call=>call.variantId)).toEqual([ids[0],ids[0],ids[1]]);
  expect(generateCalls.map(call=>call.version)).toEqual([4,6,9]);
  expect(maxInFlight).toBe(1);
  await group.getByText("선택한 레퍼런스 원본과 비교",{exact:true}).click();
  await expect(group.getByRole("img",{name:"선택한 레퍼런스 원본 전체"})).toBeVisible();
  await expect(group.getByRole("img",{name:`생성 시안 비교: ${copies[0].headline}`})).toHaveAttribute("src",`/fixture-artwork-${ids[0]}.png`);
  await expect(group.locator(".ic-artboard img")).toHaveCount(2);
  await page.locator(".ic-page").screenshot({path:testInfo.outputPath("reference-and-saved-mock-output.png")});
  await preview.click();
  await expect(group.getByText("공용 맥미니 · 출력 대기",{exact:true})).toBeVisible();
  renders[0]={...renders[0],status:"done"};reviewable=Object.fromEntries(ids.map(id=>[id,renders[0].id]));
  await page.reload();
  await expect(group.getByRole("button",{name:"최종 검수 완료",exact:true})).toBeEnabled();
  expect(new Set(finalReads).size).toBe(2);
  await group.getByRole("button",{name:"최종 검수 완료",exact:true}).click();
  await expect(group.getByRole("img",{name:copies[0].headline,exact:true})).toHaveAttribute("src",`/fixture-final-${ids[0]}.png`);
  await group.getByRole("button",{name:"내보내기",exact:true}).first().click();
  await expect.poll(()=>exports).toEqual(["?variantId="+ids[0]]);
});

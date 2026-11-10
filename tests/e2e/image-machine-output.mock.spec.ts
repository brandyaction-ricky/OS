import { expect, test } from "@playwright/test";
import { emptyImageCreative, approveImageFormat, reviewImageBatch, startImageCopyBatch, type CreativeVariant } from "../../lib/image-creative/model";

// Run in a local non-demo server with NEXT_PUBLIC_SUPABASE_URL=https://image-ui-test.supabase.co
// and a fictional publishable key. The browser blocks every external network request.
test.skip(process.env.IMAGE_MACHINE_MOCK_E2E !== "true", "Requires the local mock-auth server.");

test("요청한 Mac에서 출력한 파일만 내려받고 실패한 묶음은 다른 Mac으로 다시 보낸다", async ({ page }) => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const project = { id: "00000000-0000-4000-8000-000000000002", title: "테스트 광고", version: 4 };
  const imageId = "00000000-0000-4000-8000-000000000003";
  const batchId = "00000000-0000-4000-8000-000000000004";
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") + "." +
    Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", exp: expires })).toString("base64url") + ".fixture";
  await page.addInitScript(({ owner, token, expires }) => {
    localStorage.setItem("sb-image-ui-test-auth-token", JSON.stringify({ access_token: token, refresh_token: "fixture", expires_at: expires,
      expires_in: 3600, token_type: "bearer", user: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test",
        app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
  }, { owner, token, expires });

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

  await page.goto("/content/images?project=" + project.id);
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

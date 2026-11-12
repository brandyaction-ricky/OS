// Starts the real OS app in local demo mode. The subscription endpoint only exists in this loopback process.
import { createServer } from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import next from "next";
import nextEnvironment from "@next/env";
import { createImageBatch, emptyImageCreative, imageBriefProblems, imageCreativePrompt, ImageCreativeError } from "../lib/image-creative/model.ts";
import { isImageFormat } from "../lib/image-creative/formats.ts";
import { z } from "zod";
import { appealSchema, appealsPrompt, conceptsPrompt, imageBriefSchema, imageDirectionSchema, parseAppealOptions, parseConcepts, parseScenePlan, sceneFormatCatalog, scenePlanPrompt, selectedReferencePlan } from "../lib/image-creative/direction.ts";

const host = "127.0.0.1", port = Number(process.env.PORT || 3491);
const origin = "http://" + host + ":" + port;
const canon = z.string().uuid().parse(process.env.IMAGE_AD_OPERATING_DOC);
const catalogFile = process.argv[2];
if (!catalogFile || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("사용법: node tools/dev-image-direction.mjs 승인된-개발용-상품.json");
nextEnvironment.loadEnvConfig(process.cwd(), true);
if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("이 개발 실행기는 로컬 체험 환경에서만 사용할 수 있습니다.");

const productSource = z.object({id:z.string().uuid(), version:z.number().int().positive(), title:z.string().max(300)});
const product = z.object({id:z.string().min(1).max(80), product:z.string().min(1).max(300), brand:z.string().max(40),
  audience:z.string().max(2000), offer:z.string().max(2000), objective:z.string().max(2000).optional(),
  funnel:z.string().max(2000).optional(),source:productSource,audienceSource:productSource.optional()});
const catalog = z.array(product).min(1).max(20).parse(JSON.parse(await readFile(catalogFile,"utf8")));
process.env.NODE_ENV = "development";
process.env.IMAGE_AD_LOCAL_CATALOG = JSON.stringify(catalog);
nextEnvironment.updateInitialEnv({NODE_ENV:"development", IMAGE_AD_LOCAL_CATALOG:process.env.IMAGE_AD_LOCAL_CATALOG});
const cli = process.env.CODEX_APP_RUNTIME_CLI_PATH || "codex";
const account = spawnSync(cli,["login","status"],{encoding:"utf8",timeout:8000});
if (account.status!==0 || !/using ChatGPT/i.test((account.stdout||"")+(account.stderr||""))) throw new Error("Codex 구독 로그인이 필요합니다.");
const config = await readFile(path.join(process.env.CODEX_HOME || path.join(homedir(),".codex"),"config.toml"),"utf8");
const servers = [...config.matchAll(/^\[mcp_servers\.([\w-]+)\]\s*$/gm)].map(match=>match[1]);
if (!servers.includes("brandy-os")) throw new Error("기존 Brandy OS MCP 연결이 필요합니다.");
const args = ["exec","--skip-git-repo-check","--ephemeral","--sandbox","read-only","--json","-c",'approval_policy="never"',
  "-c",'web_search="disabled"',"-c",'model_provider="openai"',"-c",'model_reasoning_effort="low"',
  "-c",'mcp_servers.brandy-os.enabled_tools=["get_document"]'];
for (const feature of ["shell_tool","unified_exec","multi_agent","apps","browser_use","plugins","memories"]) args.push("--disable",feature);
for (const server of servers.filter(s=>s!=="brandy-os")) args.push("-c","mcp_servers."+server+".enabled=false");

// Parse the same brief as the connected OS. Product facts must match the selected catalog entry.
const incoming = z.object({phase:z.enum(["appeals","copy","concepts"]).optional(),brief:imageBriefSchema,
  count:z.number().int().min(1).max(20).optional(),appeals:z.array(appealSchema).min(1).max(20).optional(),
  mode:z.enum(["standalone","appeal"]).optional(),referenceId:z.string().refine(isImageFormat).optional(),
  asset:z.object({path:z.string().regex(/^demo\/[a-zA-Z0-9_-]{1,100}\.png$/),w:z.number().int().min(1).max(20000),h:z.number().int().min(1).max(20000)}).strict().optional(),
  direction:imageDirectionSchema.optional(), previousScenes:z.array(z.string().max(600)).max(8).default([]),
  size:z.enum(["portrait","square","story"]).optional()}).strict();

async function withSubscription(prompt) {
  const dir = await mkdtemp(path.join(tmpdir(),"os-ad-planning-"));
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.endsWith("API_KEY") || key==="IMAGE_AD_LOCAL_CATALOG") delete env[key];
  const child = spawn(cli,[...args,"-"],{cwd:dir,env,stdio:["pipe","pipe","ignore"]});
  const exit = new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  const deadline = setTimeout(()=>child.kill("SIGKILL"),180_000);
  let checked = false, answer = "";
  try {
    child.stdin.on("error",()=>{});
    child.stdin.end("기존 Brandy OS MCP get_document로 운영 정본 "+canon+"의 원문을 실제 조회한 뒤 아래 직원의 이미지 광고 기획을 수행하세요. 다른 도구·파일 작업은 불필요합니다. 마지막 메시지는 요청한 JSON 객체만 출력하세요.\n"+prompt);
    for await (const line of createInterface({input:child.stdout})) {
      const event = JSON.parse(line);
      const item = event.item;
      if (event.type !== "item.completed" || !item) continue;
      if (item.type === "mcp_tool_call" && item.server === "brandy-os" && item.tool === "get_document" &&
          item.status === "completed" && item.arguments?.document_id === canon && !item.result?.isError) {
        const block = item.result?.content?.find(part=>part.type==="text");
        try { const doc=JSON.parse(block.text).document; if(doc.id===canon && doc.content_md?.length) checked=true; } catch { /* A failed read is not a receipt. */ }
      }
      if (item.type === "agent_message") answer = item.text;
    }
    if (await exit !== 0 || !checked) throw new Error("구독 AI 실행과 OS 정본 조회를 확인하지 못했습니다.");
    return JSON.parse(answer.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,""));
  } finally {
    clearTimeout(deadline);
    if (child.exitCode===null && child.signalCode===null) child.kill("SIGKILL");
    await rm(dir,{recursive:true,force:true});
  }
}

async function plan(req) {
  const chunks=[]; let bytes=0;
  for await(const chunk of req) {
    bytes+=chunk.length;
    if (bytes>70_000) throw new Error("기획 입력 크기를 줄여 주세요.");
    chunks.push(chunk);
  }
  const input = incoming.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const brief = input.brief;
  if (imageBriefProblems(brief,true).length) throw new Error("상품 기획의 필수 내용을 확인해 주세요.");
  if (brief.productSource) {
    const ref = brief.productSource;
    const entry = catalog.find(row=>row.id===ref.productId);
    if (!entry || entry.source.id!==ref.source.id || entry.source.version!==ref.source.version ||
        entry.audienceSource?.id!==ref.audienceSource?.id || entry.audienceSource?.version!==ref.audienceSource?.version ||
        entry.product!==brief.product || entry.audience!==brief.audience || entry.offer!==brief.offer || entry.brand!==brief.brand)
      throw new Error("상품 정본을 다시 선택해 주세요.");
  }
  if (input.phase==="appeals") {
    if (!input.count) throw new Error("추천받을 소구점 수를 확인해 주세요.");
    return {appealOptions:parseAppealOptions(await withSubscription(appealsPrompt(brief,input.count)),input.count).appeals};
  }
  if (input.phase==="copy") {
    if (!input.mode || !input.size || !input.appeals || !input.referenceId) throw new Error("선택한 소구점과 레퍼런스를 확인해 주세요.");
    const {mode,size,appeals,referenceId,asset} = input;
    const state = {...emptyImageCreative(),brief,formatRecommendation:selectedReferencePlan(brief,mode,size,appeals)};
    const request = {mode,size,count:appeals.length,formatIds:[referenceId],assetPaths:asset ? [asset.path] : []};
    const guide = imageCreativePrompt(state,request) + (asset ? "\n선택한 프로젝트 이미지의 정보: "+JSON.stringify(asset) : "");
    const check = result => {
      createImageBatch(state,request,result,{now:new Date().toISOString(),by:"개발 확인",newId:()=>crypto.randomUUID(),assets:asset ? [asset] : []});
      return result;
    };
    const draft = await withSubscription(guide);
    try {return check(draft);}
    catch (error) {
      if (!(error instanceof ImageCreativeError)) throw error;
      return check(await withSubscription(guide+"\n첫 초안의 검사 결과입니다. 이 항목을 고쳐 전체 JSON을 다시 작성하세요.\n"+error.message));
    }
  }
  if (input.phase==="concepts") {
    if (!input.count) throw new Error("소구점 수를 확인해 주세요.");
    return parseConcepts(await withSubscription(conceptsPrompt(brief,input.count)),input.count);
  }
  if (!input.direction || !input.appeals || !input.size) throw new Error("소구점과 컨셉, 표현 방식을 선택해 주세요.");
  const formats=sceneFormatCatalog(brief,input.size,input.direction.medium);
  const prior=input.previousScenes;
  return parseScenePlan(await withSubscription(scenePlanPrompt(brief,input.appeals,input.direction,formats,prior)),formats,prior);
}

const app = next({dev:true,hostname:host,port});
await app.prepare();
const handle = app.getRequestHandler();
let busy = false;
const server=createServer(async(req,res)=>{
  if (req.headers.host!==host+":"+port){res.writeHead(403).end();return;}
  if (req.url!=="/api/dev/image-ad-direction"){await handle(req,res);return;}
  const send=(status,value)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(value));};
  if (req.method!=="POST" || req.headers.origin!==origin || req.headers["content-type"]?.split(";")[0]!=="application/json") {
    send(403,{error:{message:"이 개발 화면 안에서 요청해 주세요."}});return;
  }
  if(busy){send(409,{error:{message:"현재 구독 AI가 기획 중입니다. 완료 후 다시 요청해 주세요."}});return;}
  busy=true;
  try{send(200,await plan(req));}
  catch{send(422,{error:{code:"LOCAL_PLANNER_FAILED",message:"구독 AI에서 검증된 기획을 받지 못했습니다. 상품·입력과 구독 AI의 OS 연결을 확인해 주세요."}});}
  finally{busy=false;}
});
server.on("upgrade",app.getUpgradeHandler());
server.listen(port,host,()=>console.log("이미지 광고 OS 개발 화면",origin+"/content/images"));

// Starts the real OS app in local demo mode. The subscription endpoint only exists in this loopback process.
import { createServer } from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import next from "next";
import nextEnvironment from "@next/env";
import { createImageBatch, emptyImageCreative, imageBriefProblems, imageCreativePrompt, ImageCreativeError } from "../lib/image-creative/model.ts";
import { liveImageCatalogs } from "./dev-image-canon.mjs";
import { imageBriefMatchesProduct, IMAGE_PRODUCT_CANON_TITLES } from "../lib/image-creative/products.ts";
import { WAREHOUSE_INDEX_TITLE } from "../lib/image-creative/reference-canon.ts";
import { isReferenceLayout } from "../lib/image-creative/reference-layout.ts";
import { isImageFormat } from "../lib/image-creative/formats.ts";
import { z } from "zod";
import { appealSchema, imageBriefSchema, imageDirectionSchema, parseScenePlan, sceneFormatCatalog, scenePlanPrompt, selectedReferencePlan } from "../lib/image-creative/direction.ts";

const host = "127.0.0.1", port = Number(process.env.PORT || 3491);
const origin = "http://" + host + ":" + port;
const canon = z.string().uuid().parse(process.env.IMAGE_AD_OPERATING_DOC);
const catalogFile = process.argv[2];
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("개발 서버 포트를 확인해 주세요.");
nextEnvironment.loadEnvConfig(process.cwd(), true);
if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("이 개발 실행기는 로컬 체험 환경에서만 사용할 수 있습니다.");

const sourceIds = new Map();
if (catalogFile) {
  const source = z.object({id:z.string().uuid(),title:z.string()});
  const records = z.array(z.object({source,audienceSource:source.optional()})).parse(JSON.parse(await readFile(catalogFile,"utf8")));
  for (const record of records) for (const entry of [record.source,record.audienceSource]) {
    if (entry && IMAGE_PRODUCT_CANON_TITLES.includes(entry.title)) sourceIds.set(entry.title,entry.id);
  }
}
for (const [index,key] of ["IMAGE_AD_CHANNEL_DOC","IMAGE_AD_AUDIENCE_DOC","IMAGE_AD_PRODUCT_LIST_DOC"].entries()) {
  if (process.env[key]) sourceIds.set(IMAGE_PRODUCT_CANON_TITLES[index],z.string().uuid().parse(process.env[key]));
}
if (process.env.IMAGE_AD_WAREHOUSE_DOC) sourceIds.set(WAREHOUSE_INDEX_TITLE,z.string().uuid().parse(process.env.IMAGE_AD_WAREHOUSE_DOC));
process.env.NODE_ENV = "development";
process.env.IMAGE_AD_LIVE_CANON = "1";
nextEnvironment.updateInitialEnv({NODE_ENV:"development", IMAGE_AD_LIVE_CANON:"1"});
const cli = process.env.CODEX_APP_RUNTIME_CLI_PATH || "codex";
const config = await readFile(path.join(process.env.CODEX_HOME || path.join(homedir(),".codex"),"config.toml"),"utf8");
const servers = [...config.matchAll(/^\[mcp_servers\.([\w-]+)\]\s*$/gm)].map(match=>match[1]);
if (!servers.includes("brandy-os")) throw new Error("기존 Brandy OS MCP 연결이 필요합니다.");
const args = ["exec","--skip-git-repo-check","--ephemeral","--sandbox","read-only","--json","-c",'approval_policy="never"',
  "-c",'web_search="disabled"',"-c",'model_provider="openai"',"-c",'model_reasoning_effort="low"',
  "-c",'mcp_servers.brandy-os.enabled_tools=["get_document"]'];
for (const feature of ["shell_tool","unified_exec","multi_agent","apps","browser_use","plugins","memories"]) args.push("--disable",feature);
const isolation = servers.filter(s=>s!=="brandy-os").flatMap(s=>["-c","mcp_servers."+s+".enabled=false"]);
args.push(...isolation);
const readCatalog = liveImageCatalogs(cli,["--disable","apps","-c",'mcp_servers.brandy-os.enabled_tools=["get_document","search_knowledge"]',...isolation],sourceIds);

// Parse the same brief as the connected OS. Product facts must match the selected catalog entry.
const demoAssetPath = /^(?:demo\/[a-zA-Z0-9_-]{1,100}\.png|youtube\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/image-creative\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg))$/i;
const localAsset = z.object({path:z.string().regex(demoAssetPath),w:z.number().int().min(1).max(20000),h:z.number().int().min(1).max(20000)}).strict().optional();
const incoming = z.object({phase:z.literal("copy").optional(),brief:imageBriefSchema,
  count:z.number().int().min(1).max(20).optional(),appeals:z.array(appealSchema).min(1).max(20).optional(),
  mode:z.enum(["standalone","appeal"]).optional(),referenceId:z.string().refine(isImageFormat).optional(),
  referenceLayout:z.custom(isReferenceLayout).refine(layout=>demoAssetPath.test(layout.source.path)).optional(),
  referenceSnapshot:z.object({id:z.string().refine(isImageFormat),documentId:z.string().uuid(),version:z.number().int().positive(),
    name:z.string().min(1).max(300),keep:z.string().max(3000),slots:z.string().max(3000)}).strict().optional(),
  asset:localAsset,detailAsset:localAsset,
  direction:imageDirectionSchema.optional(), previousScenes:z.array(z.string().max(600)).max(8).default([]),
  size:z.enum(["portrait","square","story"]).optional()}).strict();

async function withSubscription(prompt, outputSchema) {
  const account = spawnSync(cli,["login","status"],{encoding:"utf8",timeout:8000});
  if (account.status!==0 || !/using ChatGPT/i.test((account.stdout||"")+(account.stderr||""))) throw new Error("Codex 구독 로그인이 필요합니다.");
  const dir = await mkdtemp(path.join(tmpdir(),"os-ad-planning-"));
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.endsWith("API_KEY") || key==="IMAGE_AD_LOCAL_CATALOG") delete env[key];
  const schemaFile = path.join(dir,"expected-output.json");
  if (outputSchema) await writeFile(schemaFile,JSON.stringify(outputSchema));
  const child = spawn(cli,[...args,...(outputSchema ? ["--output-schema",schemaFile] : []),"-"],{cwd:dir,env,stdio:["pipe","pipe","ignore"]});
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
  // Copy continues the approved local brief. Only an unapproved plan must follow today's catalog.
  if (brief.productSource && input.phase!=="copy") {
    const ref = brief.productSource;
    const {products} = await readCatalog("products");
    const entry = products.find(row=>row.id===ref.productId);
    if (!imageBriefMatchesProduct(brief,entry))
      throw new ImageCreativeError("IMAGE_PRODUCT_CHANGED","상품 정본이 바뀌었어요. 페이지를 새로고침해 최신 상품 정보를 확인해 주세요.",409);
  }
  if (input.phase==="copy") {
    if (!input.mode || !input.size || !input.appeals || !input.referenceId) throw new Error("선택한 소구점과 레퍼런스를 확인해 주세요.");
    const {mode,size,appeals,referenceId,asset,referenceLayout,detailAsset} = input;
    if ((referenceId === "reference_image") !== Boolean(referenceLayout) ||
        (referenceLayout && (Boolean(referenceLayout.photo) !== Boolean(asset) || asset?.path === referenceLayout.source.path)))
      throw new ImageCreativeError("IMAGE_REFERENCE_INVALID","원본 레퍼런스와 사용할 이미지 영역을 확인해 주세요.",422);
    const recommendation = selectedReferencePlan(brief,mode,size,appeals);
    if (input.referenceSnapshot) {
      if (input.referenceSnapshot.id!==referenceId) throw new Error("선택한 레퍼런스 원문을 확인해 주세요.");
      recommendation.referenceSnapshot = input.referenceSnapshot;
    }
    const state = {...emptyImageCreative(),brief,formatRecommendation:recommendation};
    const request = {mode,size,count:appeals.length,formatIds:[referenceId],assetPaths:asset ? [asset.path] : [],...(referenceLayout && {referenceLayout}),...(detailAsset && {detailAssetPath:detailAsset.path})};
    const guide = imageCreativePrompt(state,request,true);
    const schema = {type:"object",properties:{copies:{type:"array",items:{type:"object",properties:{
      headline:{type:"string"},body:{type:"string"},cta:{type:"string"}
    },required:["headline","body","cta"],additionalProperties:false}}},required:["copies"],additionalProperties:false};
    const check = result => {
      const checked = createImageBatch(state,request,result,{now:new Date().toISOString(),by:"개발 확인",newId:()=>crypto.randomUUID(),assets:[...(referenceLayout ? [referenceLayout.source] : []),...(asset ? [asset] : []),...(detailAsset ? [detailAsset] : [])]});
      return {variants:checked.variants.map(({copy})=>({copy}))};
    };
    const draft = await withSubscription(guide,schema);
    try {return check(draft);}
    catch (error) {
      if (!(error instanceof ImageCreativeError)) throw error;
      return check(await withSubscription(guide+"\n첫 초안과 검사 결과입니다. 이 항목을 고쳐 전체 JSON을 다시 작성하세요.\n"+JSON.stringify(draft)+"\n"+error.message,schema));
    }
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
  const send=(status,value)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"private, no-store"});res.end(JSON.stringify(value));};
  const kind = {"/api/dev/image-ad-products":"products","/api/dev/image-ad-references":"references"}[req.url];
  if (kind) {
    if (req.method!=="GET" || (req.headers.origin && req.headers.origin!==origin) ||
        (req.headers["sec-fetch-site"] && !["same-origin","none"].includes(req.headers["sec-fetch-site"]))) {
      send(403,{error:{message:"이 개발 화면 안에서 조회해 주세요."}});return;
    }
    try {send(200,await readCatalog(kind));}
    catch {send(503,{error:{code:"IMAGE_CANON_UNAVAILABLE", message:"OS 최신 원문을 읽지 못했습니다. 연결을 확인하고 다시 불러오세요."}});}
    return;
  }
  if(req.url!=="/api/dev/image-ad-direction"){await handle(req,res);return;}
  if (req.method!=="POST" || req.headers.origin!==origin || req.headers["content-type"]?.split(";")[0]!=="application/json") {
    send(403,{error:{message:"이 개발 화면 안에서 요청해 주세요."}});return;
  }
  if(busy){send(409,{error:{message:"현재 구독 AI가 기획 중입니다. 완료 후 다시 요청해 주세요."}});return;}
  busy=true;
  try{send(200,await plan(req));}
  catch(error){if(error instanceof ImageCreativeError){send(error.status,{error:{code:error.code,message:error.message}});return;}send(422,{error:{code:"LOCAL_PLANNER_FAILED",message:"구독 AI에서 검증된 기획을 받지 못했습니다. 상품·입력과 구독 AI의 OS 연결을 확인해 주세요."}});}
  finally{busy=false;}
});
server.on("upgrade",app.getUpgradeHandler());
server.listen(port,host,()=>console.log("이미지 광고 OS 개발 화면",origin+"/content/images"));

// The same OS format modules and pinned Next/OG build travel with the video engine to a member's computer.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const modules = ["formats.ts", "placement.ts", "view.tsx", "safe-artwork.mjs", "format-test-renderer.mjs", "format-test-renderer-v1.mjs", "format-test-fonts.json"];
const bodyFonts = [400, 500, 600];
const displayFonts = ["hand", "sign", "serif"];
const staticFiles = [
  ["public/fonts/pretendard/PretendardVariable.woff2", "fonts/PretendardVariable.woff2"],
  ...bodyFonts.map(w => [`lib/cardnews/fonts/Pretendard-${w}.woff`, `fonts/Pretendard-${w}.woff`]),
  ...displayFonts.flatMap(f => [[`lib/image-creative/fonts/${f}.woff`, `fonts/${f}.woff`], [`public/image-format-test/fonts/${f}.woff2`, `fonts/${f}.woff2`]]),
  ["lib/cardnews/fonts/LICENSE", "fonts/Pretendard-LICENSE"],
];
const ogFiles = ["index.node.js", "noto-sans-v27-latin-regular.ttf", "yoga.wasm", "resvg.wasm", "LICENSE", "satori/LICENSE"];
const reactFiles = ["package.json", "LICENSE", "index.js", "jsx-runtime.js", "cjs/react.development.js", "cjs/react.production.js", "cjs/react-jsx-runtime.development.js", "cjs/react-jsx-runtime.production.js"];

function runtimeFiles(root) {
  const require = createRequire(path.join(root, "package.json"));
  const ogDir = path.dirname(require.resolve("next/dist/compiled/@vercel/og"));
  const reactDir = path.dirname(require.resolve("react/package.json"));
  const rows = modules.map(f => [path.join(root, "lib/image-creative", f), f.replace(/\.tsx?$/, ".mjs")]);
  for (const [src,dest] of staticFiles) rows.push([path.join(root,src),dest]);
  for (const name of displayFonts) rows.push([path.join(root,"public/image-format-test/fonts",name+"-OFL.txt"),"fonts/"+name+"-OFL.txt"]);
  for (const f of ogFiles) rows.push([path.join(ogDir,f),"og/"+f]);
  for (const f of reactFiles) rows.push([path.join(reactDir,f),"node_modules/react/"+f]);
  return rows;
}

export function adRuntimeDigest(root) {
  const receipt = path.join(root, "image-renderer", "FINGERPRINT");
  const installed = existsSync(receipt) ? readFileSync(receipt, "utf8").trim() : "";
  if (installed && !/^[a-f0-9]{64}$/.test(installed)) throw new Error("광고 렌더러 배포 파일을 확인해 주세요.");
  if (!existsSync(path.join(root, "lib/image-creative/view.tsx"))) return installed;
  try {
    const hash = createHash("sha256");
    for (const [file, name] of runtimeFiles(root)) hash.update(name + "\0").update(readFileSync(file));
    const require = createRequire(path.join(root, "package.json"));
    return hash.update(require("typescript/package.json").version).digest("hex");
  } catch (error) {
    // A video-only release can still render videos. A prepared ad bundle works without npm on the Mac.
    if (["MODULE_NOT_FOUND", "ENOENT"].includes(error.code)) return installed;
    throw error;
  }
}

export function buildAdRuntime(root,out) {
  const installed = path.join(root,"image-renderer");
  if (existsSync(path.join(installed,"FINGERPRINT")) && readFileSync(path.join(installed,"FINGERPRINT"),"utf8").trim()===adRuntimeDigest(root)) {
    if (path.resolve(out) !== path.resolve(installed)) {
      const files = ["package.json", "FINGERPRINT", ...modules.map(f => f.replace(/\.tsx?$/, ".mjs")),
        ...staticFiles.map(([,name]) => name), ...displayFonts.map(f => "fonts/" + f + "-OFL.txt"),
        ...ogFiles.map(f => "og/" + f), ...reactFiles.map(f => "node_modules/react/" + f)];
      for (const name of files) {
        const dest = path.join(out, name);
        mkdirSync(path.dirname(dest), { recursive: true });
        cpSync(path.join(installed, name), dest);
      }
    }
    return out;
  }
  const ts = createRequire(path.join(root,"package.json"))("typescript");
  mkdirSync(out,{recursive:true});
  writeFileSync(path.join(out,"package.json"),'{"type":"module"}');
  for (const [source,name] of runtimeFiles(root)) {
    const dest = path.join(out,name);
    mkdirSync(path.dirname(dest),{recursive:true});
    if (/\.tsx?$/.test(source) || name === "safe-artwork.mjs") {
      let code = readFileSync(source,"utf8");
      if (/\.tsx?$/.test(source)) code = ts.transpileModule(code,{fileName:source, compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
      writeFileSync(dest,code.replace(/(from "\.\/[\w-]+)\.ts"/g,'$1.mjs"'));
    } else cpSync(source,dest);
  }
  writeFileSync(path.join(out,"FINGERPRINT"),adRuntimeDigest(root)+"\n");
  return out;
}

let tempRuntime;
export function installedAdRuntime(root) {
  const packed = path.join(root,"image-renderer");
  if (existsSync(path.join(packed,"FINGERPRINT")) && readFileSync(path.join(packed,"FINGERPRINT"),"utf8").trim()===adRuntimeDigest(root)) return packed;
  if (!tempRuntime) {
    const dir=mkdtempSync(path.join(os.tmpdir(),"os-ad-engine-"));
    try { tempRuntime=buildAdRuntime(root,dir); }
    catch(error) { rmSync(dir,{recursive:true,force:true});throw error; }
    process.once("exit",()=>rmSync(dir,{recursive:true,force:true}));
  }
  return tempRuntime;
}

const fileUrl = (dir,name)=>pathToFileURL(path.join(dir,name)).href;
const font = (dir,name)=>readFileSync(path.join(dir,"fonts",name));
function chooseChrome() {
  return process.env.CHROME_PATH || (process.platform==="darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
}

// Chrome reads an isolated, self-contained file. Only the canvas PNG leaves the temporary profile.
async function svgPng(svg,width,height,chromePath) {
  const dir=mkdtempSync(path.join(os.tmpdir(),"os-ad-chrome-"));
  try {
    const src=Buffer.from(svg).toString("base64");
    const html=path.join(dir,"draw.html");
    writeFileSync(html,`<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; script-src 'unsafe-inline'"><output></output><script>
(async () => {
  const bytes = Uint8Array.from(atob("${src}"), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], {type:"image/svg+xml;charset=utf-8"}));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = ${width}; canvas.height = ${height};
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
    document.querySelector("output").textContent = canvas.toDataURL("image/png").slice(22);
    document.querySelector("script").remove();
  } finally { URL.revokeObjectURL(url); }
})();</script>`);
    const {stdout}=await run(chromePath,["--headless","--disable-extensions","--disable-background-networking","--no-first-run","--no-default-browser-check","--disable-component-update","--user-data-dir="+path.join(dir,"profile"),"--virtual-time-budget=5000","--dump-dom",pathToFileURL(html).href],{timeout:60_000,maxBuffer:100*1024*1024,env:{PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:os.tmpdir(),SystemRoot:process.env.SystemRoot}});
    const match=stdout.match(/<output>([A-Za-z0-9+/=]+)<\/output>/);
    if (!match) throw new Error("브라우저가 PNG를 완성하지 못했어요.");
    return Buffer.from(match[1],"base64");
  } catch { throw new Error("광고 PNG 제작에 실패했어요. 이 컴퓨터의 Chrome과 영상 엔진 버전을 확인해 주세요."); }
  finally {rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}

export async function renderAdPng(dir,variant,photoDataUrl,options={}) {
  const {isWarehouseFormat}=await import(fileUrl(dir,"formats.mjs"));
  const {resolvePlacement}=await import(fileUrl(dir,"placement.mjs"));
  const {width,height}=resolvePlacement(variant.size,variant.design?.placement,variant.design?.outputWidth);
  if (Boolean(variant.asset)!==Boolean(photoDataUrl) || (photoDataUrl && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(photoDataUrl))) throw new Error("작업에 등록한 원본 사진을 확인해 주세요.");
  const selected=variant.design?.font||"original";
  if (!["original","sans",...displayFonts].includes(selected)) throw new Error("허용한 글꼴을 선택해 주세요.");
  if (isWarehouseFormat(variant.formatId)) {
    if (![1,2].includes(variant.formatVersion)) throw new Error("창고 포맷 버전을 확인해 주세요.");
    const {renderFormatTestSvg}=await import(fileUrl(dir,variant.formatVersion===1?"format-test-renderer-v1.mjs":"format-test-renderer.mjs"));
    const faces=JSON.parse(readFileSync(path.join(dir,"format-test-fonts.json"),"utf8"));
    const display=selected==="original" ? (variant.formatVersion===2 && faces[variant.formatId]) : selected!=="sans" && selected+".woff2";
    const data=name=>"data:font/woff2;base64,"+font(dir,name).toString("base64");
    const {headline,body,cta}=variant.copy;
    const svg=renderFormatTestSvg({formatId:variant.formatId,copy:{brand:variant.brand,headline,support:body,cta},photo:photoDataUrl,fontData:data("PretendardVariable.woff2"),displayFontData:display?data(display):undefined,design:variant.design});
    return svgPng(svg,width,height,options.chromePath || chooseChrome());
  }
  const { ImageCreativeView }=await import(fileUrl(dir,"view.mjs"));
  const { ImageResponse }=await import(fileUrl(dir,"og/index.node.js"));
  const fonts=bodyFonts.map(weight=>({name:"Pretendard",data:font(dir,`Pretendard-${weight}.woff`),style:"normal",weight}));
  if (displayFonts.includes(selected)) fonts.push({name:"Ad-"+selected,data:font(dir,selected+".woff"),style:"normal",weight:600});
  return Buffer.from(await new ImageResponse(ImageCreativeView({variant,assetUrl:photoDataUrl}),{width,height,fonts}).arrayBuffer());
}

function storageUrl(raw,upload=false) {
  const url=new URL(raw);
  const prefix=upload?"/storage/v1/object/upload/sign/":"/storage/v1/object/sign/";
  if (url.protocol!=="https:" || url.username || url.password || !url.pathname.startsWith(prefix)) throw new Error("광고 파일의 임시 저장소 주소를 확인해 주세요.");
  return url;
}
async function scenePhoto(url) {
  const response=await fetch(storageUrl(url),{redirect:"error",signal:AbortSignal.timeout(60_000)});
  const type=response.headers.get("content-type")?.split(";")[0];
  if (!response.ok || !["image/png","image/jpeg"].includes(type)) throw new Error("등록 사진을 읽지 못했어요.");
  // A 20-megapixel source can expand to 80 MB after the OS fixes orientation and converts it to PNG.
  const chunks=[];let length=0;
  for await(const chunk of response.body) {
    length+=chunk.byteLength;
    if(length>85_000_000) throw new Error("등록 사진이 너무 큽니다.");
    chunks.push(chunk);
  }
  return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
}

export async function processAdRender(call,root,progress=()=>{}) {
  const job=await call({action:"image_creative_claim",rendererVersion:1});
  if (job.idle) return false;
  const lease={jobId:job.jobId,lease:job.lease};
  let reason="이 컴퓨터의 광고 렌더러를 확인해 주세요.";
  let completing=false;
  try {
    const runtime=installedAdRuntime(root);
    if (!Array.isArray(job.variantIds) || job.variantIds.length<1 || job.variantIds.length>20 || new Set(job.variantIds).size!==job.variantIds.length) throw new Error("bad batch");
    const files=[];
    for(const variantId of job.variantIds) {
      reason="이 작업에 등록한 시안과 사진을 읽지 못했어요.";
      progress("download");
      const scene=await call({action:"image_creative_scene",...lease,variantId});
      if (scene.variant?.id!==variantId) throw new Error("variant mismatch");
      const photo=scene.photoUrl ? await scenePhoto(scene.photoUrl) : undefined;
      reason="선택한 컴퓨터에서 광고 PNG를 만들지 못했어요. 설치된 Chrome과 영상 엔진을 확인해 주세요.";
      progress("drawing");
      const png=await renderAdPng(runtime,scene.variant,photo);
      if (png.length<33 || png.length>20*1024*1024 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16)!==scene.width || png.readUInt32BE(20)!==scene.height) throw new Error("invalid PNG");
      progress("upload");
      reason="완성된 광고 파일을 작업에 저장하지 못했어요.";
      const sha256=createHash("sha256").update(png).digest("hex");
      const slot=await call({action:"image_creative_prepare",...lease,variantId,fileSize:png.length});
      const response=await fetch(storageUrl(slot.signedUrl,true),{method:"PUT",headers:{"content-type":"image/png"},body:png,redirect:"error",signal:AbortSignal.timeout(90_000)});
      if(!response.ok) throw new Error("upload incomplete");
      files.push({variantId,bytes:png.length,sha256});
    }
    // Once submitted the entire manifest may already be committed despite a lost reply.
    completing=true;
    await call({action:"image_creative_complete",...lease,files});
  } catch (error) {
    // A rejected PNG has a definite outcome; a lost acknowledgement may follow a successful commit.
    const rejected = ["IMAGE_RENDER_FILE", "IMAGE_RENDER_INCOMPLETE", "IMAGE_RENDER_HASH", "IMAGE_RENDER_SIZE"].includes(error.code);
    if (completing && !rejected) throw new Error("광고 묶음의 완료 응답을 확인하지 못했어요. OS의 저장 상태를 확인해 주세요.");
    await call({action:"image_creative_fail", ...lease, reason});
  } finally {
    progress(null);
  }
  return true;
}

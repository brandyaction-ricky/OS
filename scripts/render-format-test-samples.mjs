import {readFile, writeFile, mkdir} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {FORMAT_TEST_FORMATS, renderFormatTestSvg} from "../lib/image-creative/format-test-renderer.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dependencyRoot=process.env.OS_PROJECT_ROOT || root;
const require=createRequire(path.join(dependencyRoot,"package.json"));
const {chromium}=require("playwright");
const [photoPath=path.join(root,"public/image-format-test/master.jpg"),out=path.join(root,"format-test-samples")]=process.argv.slice(2);
const [font,source]=await Promise.all([readFile(path.join(dependencyRoot,"public/fonts/pretendard/PretendardVariable.woff2")),readFile(photoPath)]);
if(source[0]!==0xff || source[1]!==0xd8) throw new Error("Sample photograph must be JPEG.");
const photo="data:image/jpeg;base64,"+source.toString("base64");
const fontData="data:font/woff2;base64,"+font.toString("base64");
const displayFiles=JSON.parse(await readFile(path.join(root,"lib/image-creative/format-test-fonts.json"),"utf8"));
const copy={brand:"마이인",headline:"저장한 공고는 많은데, 어디에 지원하지?",support:"내 강점에서 일 고르는 기준을 찾아보세요.",cta:"무료 진단 시작하기"};
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
await mkdir(out,{recursive:true});
const page=await browser.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:1});
try{
 for(const {id} of FORMAT_TEST_FORMATS){
  const extra=displayFiles[id] ? await readFile(path.join(root,"public/image-format-test/fonts",displayFiles[id])) : undefined;
  const displayFontData=extra ? "data:font/woff2;base64,"+extra.toString("base64") : undefined;
  const svg=renderFormatTestSvg({formatId:id,copy,photo,fontData,displayFontData});
  const png=await page.evaluate(async svg=>{
   const url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"}));
   try{const im=new Image();im.src=url;await im.decode();
    const c=document.createElement("canvas");c.width=im.naturalWidth;c.height=im.naturalHeight;
    const ctx=c.getContext("2d", { willReadFrequently: true });ctx.drawImage(im,0,0);
    return c.toDataURL("image/png").split(",")[1];
   }finally{URL.revokeObjectURL(url);}
  },svg);
  await writeFile(path.join(out,id+".png"),Buffer.from(png,"base64"));
 }
}finally{await browser.close();}

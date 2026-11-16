import assert from "node:assert/strict";
import test from "node:test";
import { getSharp } from "next/dist/server/image-optimizer.js";
import { installedAdRuntime,renderAdPng } from "../tools/image-ad-renderer.mjs";
import { isReferenceLayout,referenceCopyProblems,referenceBodyParts,referenceMasterFrame } from "../lib/image-creative/reference-layout.ts";
import { resolvePlacement } from "../lib/image-creative/placement.ts";
import { approveImageFormat,createImageBatch,emptyImageCreative,imageVariantProblems } from "../lib/image-creative/model.ts";
import { selectedReferencePlan } from "../lib/image-creative/direction.ts";

const box = {x:10,y:8,w:80,h:15,fill:"transparent",color:"#ffffff",fontSize:52,align:"center"};
const layout = {source:{path:"source.png",w:108,h:135},photo:{x:0,y:0,w:100,h:100},
  headline:box,body:{...box,y:62,h:8},cta:{...box,y:82,h:9},
  master:{v:1,background:"#243440",regions:[
    {x:42,y:40,w:8,h:4,fill:"#be501c"},
    {x:4,y:55,w:30,h:5,fill:"#ffffff",sample:{x:35,y:32,flipX:true}},
    {x:36,y:55,w:30,h:5,fill:"#ffffff",sample:{x:35,y:32}},
  ],headlineWeight:900,
    keepOverPhoto:[{x:18,y:30,w:66,h:23,radius:20}],bodyContinuation:{...box,y:70,h:8}}};
const copy = {headline:"새로운 하루",body:"짧은 문장 하나 두 번째 줄",cta:"시작하기"};
const brandSlots = [{...box,y:25,h:4,fontSize:33},{...box,y:90,h:4,fontSize:23}];

test("source master validates persisted patches and keeps flow within each original text slot",()=>{
  assert.equal(isReferenceLayout(layout),true);
  for (const master of [{...layout.master,v:0},{...layout.master,background:"white"},
    {...layout.master,regions:[{x:42,y:40,w:8,h:4,fill:"transparent"}]},{...layout.master,keepOverPhoto:[{x:0,y:0,w:5,h:5,radius:51}]}])
    assert.equal(isReferenceLayout({...layout,master}),false);
  assert.equal(isReferenceLayout({...layout,body:undefined}),false);
  for (const sample of [{x:80,y:0}, {x:35,y:99}, {x:35,y:32,flipX:"false"}, {x:35,y:32,scale:2}]) {
    const regions=[{...layout.master.regions[1],sample}];
    assert.equal(isReferenceLayout({...layout,master:{...layout.master,regions}}),false);
  }
  assert.equal(isReferenceLayout({...layout,composition:{}}),false);
  assert.equal(isReferenceLayout({...layout,master:undefined,photo:undefined}),false);
  assert.deepEqual(referenceBodyParts(layout,copy.body).join(" "),copy.body);
  assert.deepEqual(referenceBodyParts(layout,"첫 번째 줄\n둘째 줄"),["첫 번째 줄","둘째 줄"]);
  assert.deepEqual(referenceCopyProblems(layout,copy),[]);
  assert.ok(referenceCopyProblems(layout,{...copy,body:"너무 긴 문장 ".repeat(70)}).length);
  for (const size of ["square","portrait","story"]) {
    const placement = resolvePlacement(size), {safe} = placement;
    const frame = referenceMasterFrame(layout,placement);
    for (const slot of [layout.headline,layout.body,layout.master.bodyContinuation,layout.cta]) {
      assert.ok(frame.x+frame.w*slot.x/100 >= safe.x-.001);
      assert.ok(frame.y+frame.h*slot.y/100 >= safe.y-.001);
      assert.ok(frame.x+frame.w*(slot.x+slot.w)/100 <= safe.x+safe.width+.001);
      assert.ok(frame.y+frame.h*(slot.y+slot.h)/100 <= safe.y+safe.height+.001);
    }
  }
});

test("a master repeats only the product brief's fixed brand, rejecting an oversized or injected name before approval",()=>{
  const ref = {...layout,source:{...layout.source,path:"demo/master.png"},master:{...layout.master,brandSlots}};
  const state = emptyImageCreative();
  state.brief = {brand:"마이인",product:"진단",offer:"결과",audience:"직장인",objective:"검사",funnel:"무료",facts:""};
  const asset = {path:"demo/alternate.png",w:32,h:32};
  const appeals=[{id:"a",meaning:"첫 소구"},{id:"b",meaning:"둘째 소구"}];
  const request={mode:"appeal",size:"portrait",count:2,formatIds:["reference_image"],assetPaths:[asset.path],referenceLayout:ref};
  state.formatRecommendation=selectedReferencePlan(state.brief,request.mode,request.size,appeals);
  const stamp={by:"tester",at:"2026-11-13T01:00:00Z"};
  const approved=approveImageFormat(state,request,stamp);
  const ctx={now:stamp.at,by:stamp.by,newId:()=>crypto.randomUUID(),assets:[asset]};
  const variants=createImageBatch(approved,request,{copies:[copy,{...copy,headline:"다른 하루"}]},ctx).variants;
  assert.deepEqual(variants.map(v=>v.brand),["마이인","마이인"]);
  assert.throws(()=>createImageBatch(approved,request,{copies:[{...copy,brand:"임의 문구"},copy]},ctx));
  assert.ok(imageVariantProblems({...variants[0],brand:undefined}).some(x=>x.includes("브랜드")));
  assert.deepEqual(referenceCopyProblems(ref,copy,"마이인"),[]);
  assert.equal(isReferenceLayout({...ref,master:{...ref.master,brandSlots:Array(5).fill(box)}}),false);
  const narrow={...ref,master:{...ref.master,brandSlots:[{...box,w:3}]}};
  assert.throws(()=>approveImageFormat(state,{...request,referenceLayout:narrow},stamp),/브랜드/);
  const noBrand={...state,brief:{...state.brief,brand:undefined}};
  assert.throws(()=>approveImageFormat(noBrand,request,stamp),/브랜드/);
});

test("Mac pixels preserve a patterned front panel, replace its background and remove only masked source marks", async()=>{
  const sharp = getSharp(), rgba=(buf,x,y)=>[...buf.subarray((1080*y+x)*3,(1080*y+x)*3+3)];
  const encode=async input=>"data:image/png;base64,"+(await input.png().toBuffer()).toString("base64");
  const raw = Buffer.alloc(108*135*3);
  for(let y=0;y<135;y++) for(let x=0;x<108;x++) raw.set(x<52?[180,50,41]:[49,160,82],(y*108+x)*3);
  // A detailed stripe catches subpixel resampling that flat-color samples cannot detect.
  for(let y=60;y<65;y++) for(let x=0;x<108;x++) raw.set([(x*17+y*23)%251,(x*11)%239,(y*29)%233],(y*108+x)*3);
  const ref=await encode(sharp(raw,{raw:{width:108,height:135,channels:3}}));
  const photo=await encode(sharp({create:{width:32,height:32,channels:3,background:"#123456"}}));
  const withBrand={...layout,master:{...layout.master,brandSlots}};
  const v={formatId:"reference_image",formatVersion:1,size:"portrait",asset:{w:32,h:32,path:"replacement.png"},referenceLayout:withBrand,brand:"마이인",copy};
  const engine=installedAdRuntime(process.cwd());
  const pixels=async (c,brand=v.brand)=>sharp(await renderAdPng(engine,{...v,copy:c,brand},photo,{referenceDataUrl:ref})).removeAlpha().raw().toBuffer();
  const a=await pixels(copy), b=await pixels({...copy,headline:"또 다른 선택"});
  assert.deepEqual(rgba(a,20,730),[18,52,86],"replacement background");
  assert.deepEqual(rgba(a,290,560),[180,50,41],"left source panel");
  assert.deepEqual(rgba(a,702,560),[49,160,82],"right source panel");
  assert.deepEqual(rgba(a,197,406),[18,52,86],"round panel corner reveals the replaced background");
  assert.deepEqual(rgba(a,491,560),[190,80,28],"original lettering inside preserved panel is painted out");
  assert.deepEqual(rgba(a,85,773),[49,160,82],"right of the source patch becomes left in the mirrored destination");
  assert.deepEqual(rgba(a,329,773),[180,50,41],"left of the source patch becomes right in the mirrored destination");
  assert.deepEqual(rgba(a,423,773),[180,50,41],"unflipped artwork keeps its source orientation");
  assert.deepEqual(rgba(a,680,773),[49,160,82]);
  assert.deepEqual(rgba(a,390,728),[18,52,86],"copying must remain clipped to the destination rectangle");
  assert.ok(!a.equals(b));
  assert.ok(a.subarray(1080*330*3).equals(b.subarray(1080*330*3)),"changing the headline leaves every lower pixel fixed");
  const changedBrand=await pixels(copy,"공방");
  const strip=(buf,y1,y2)=>buf.subarray(1080*y1*3,1080*y2*3);
  assert.ok(!strip(a,338,392).equals(strip(changedBrand,338,392)),"first brand label is populated from the product");
  assert.ok(!strip(a,1215,1269).equals(strip(changedBrand,1215,1269)),"the same product name is also printed in its second source label");
  assert.ok(strip(a,392,1215).equals(strip(changedBrand,392,1215)),"the brand never replaces approved advertising copy");
  const unchanged={...v,asset:undefined,referenceLayout:{...withBrand,photo:undefined}};
  const baseline=await sharp(await renderAdPng(engine,unchanged,undefined,{referenceDataUrl:ref})).removeAlpha().raw().toBuffer();
  for(let y=610;y<635;y++) {
    const start=(y*1080+225)*3,end=(y*1080+855)*3;
    assert.ok(a.subarray(start,end).equals(baseline.subarray(start,end)),"a fractional panel boundary must not resample the foreground");
  }
});

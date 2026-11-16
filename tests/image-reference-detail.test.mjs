import assert from "node:assert/strict";
import test from "node:test";
import { getSharp } from "next/dist/server/image-optimizer.js";
import { installedAdRuntime, renderAdPng } from "../tools/image-ad-renderer.mjs";
import { isReferenceLayout, REFERENCE_DETAIL_SLOT_LIMIT, referenceUsesBlackWeight, usesReferenceDetailAsset, usesReferenceDetailRendering } from "../lib/image-creative/reference-layout.ts";

const crop = {x:50,y:25,w:50,h:50};
const slot = {x:10,y:25,w:40,h:20,crop};
const label = {x:10,y:8,w:80,h:10,fontSize:24,align:"center",fill:"transparent",color:"#ffffff"};
const master = {v:1,background:"#ffffff",headlineWeight:600,regions:[],detailSlots:[slot]};
const layout = {source:{path:"demo/source.png",w:100,h:100},headline:label,cta:{...label,y:84},master};

test("registered detail slots accept only bounded destinations and crops from a single project image",()=>{
  assert.equal(isReferenceLayout(layout),true);
  for (const detailSlots of [
    Array(REFERENCE_DETAIL_SLOT_LIMIT+1).fill(slot), [{...slot,x:97}], [{...slot,crop:{...crop,w:52}}],
    [{...slot,crop:{...crop,src:"elsewhere.png"}}], [{...slot,crop:{...crop,w:0}}], [{...slot,radius:51}],
    [{...slot,fit:"stretch"}], [{...slot,source:"photo"}], [{...slot,source:"external"}],
  ]) assert.equal(isReferenceLayout({...layout,master:{...master,detailSlots}}),false);
  assert.equal(usesReferenceDetailAsset(layout),true);
  assert.equal(usesReferenceDetailRendering({...layout,master:{...master,detailSlots:[]}}),false);
  const bold={...layout,master:{...master,detailSlots:[]},cta:{...label,weight:900}};
  assert.equal(usesReferenceDetailRendering(bold),true);
  assert.equal(referenceUsesBlackWeight(bold),true);
  assert.equal(isReferenceLayout({...bold,cta:{...label,weight:700}}),false);
});

test("a photographic master redraws the page with owned artwork, even if the photo is removed", async()=>{
  const sharp = getSharp();
  const referenceDataUrl = "data:image/png;base64," + (await sharp({create:{width:100,height:100,channels:3,background:"#ef0099"}}).png().toBuffer()).toString("base64");
  const artwork = Buffer.alloc(20*80*3);
  for(let i=0;i<20*80;i++) artwork.set(i<20*40 ? [255,120,0] : [0,80,255],i*3);
  const owned = "data:image/png;base64," + (await sharp(artwork,{raw:{width:20,height:80,channels:3}}).png().toBuffer()).toString("base64");
  const art = {v:1,base:"solid",background:"#151515",headlineWeight:900,regions:[],headlineAccent:"#80ff85"};
  const scene = {...layout,photo:{x:0,y:0,w:100,h:60},headline:{...label,y:61,h:20,fontSize:62},master:{...art,photoFit:"contain"}};
  const variant={formatId:"reference_image",formatVersion:1,size:"square",referenceLayout:scene,asset:{path:"demo/owned.png",w:20,h:80},
    copy:{headline:"다음 기회는 어디에?",body:"",cta:""}};
  assert.ok(isReferenceLayout(scene));
  for(const change of [{base:"unsafe"},{headlineAccent:"url(x)"},{photoFit:"stretch"}]) {
    assert.equal(isReferenceLayout({...scene,master:{...scene.master,...change}}),false);
  }
  assert.equal(isReferenceLayout({...scene,photo:undefined}),false);
  const engine=installedAdRuntime(process.cwd());
  const pixels=async (v,photo)=>sharp(await renderAdPng(engine,v,photo,{referenceDataUrl})).removeAlpha().raw().toBuffer();
  const rendered=await pixels(variant,owned);
  const withoutPhoto=await pixels({...variant,asset:undefined,referenceLayout:{...scene,photo:undefined,master:art}},undefined);
  function pixel(buffer,x,y){return [...buffer.subarray((1080*y+x)*3,(1080*y+x)*3+3)];}
  assert.deepEqual(pixel(rendered,540,90),[255,120,0]);
  assert.deepEqual(pixel(rendered,540,550),[0,80,255]);
  assert.deepEqual(pixel(withoutPhoto,540,90),[21,21,21]);
  assert.deepEqual(pixel(withoutPhoto,38,405),[21,21,21]);
  assert.ok(rendered.includes(Buffer.from([128,255,133])),"accent renders in the headline");
});

test("Mac PNG composites distinct sheet crops with native alpha, contained margins, cover and rounded clipping",async()=>{
  const sharp=getSharp();
  const data=async image=>"data:image/png;base64,"+(await image.png().toBuffer()).toString("base64");
  const referenceDataUrl=await data(sharp({create:{width:100,height:100,channels:3,background:"#163644"}}));
  const sheet=Buffer.alloc(100*100*4);
  for(let y=0;y<100;y++) for(let x=0;x<100;x++) {
    const color=x<50 ? [210,50,71,255] : y<25 || y>=75 ? [231,190,15,255] : x<75 ? [51,119,221,255] : [0,0,0,0];
    sheet.set(color,(y*100+x)*4);
  }
  const detailDataUrl=await data(sharp(sheet,{raw:{width:100,height:100,channels:4}}));
  const slots=[slot,{x:55,y:25,w:30,h:30,radius:50,crop:{x:0,y:0,w:50,h:100},fit:"cover"}];
  const variant={formatVersion:1,formatId:"reference_image",size:"square",referenceLayout:{...layout,master:{...master,detailSlots:slots}},
    copy:{headline:"",body:"",cta:""},detailAsset:{path:"demo/detail.png",w:100,h:100}};
  const engine=installedAdRuntime(process.cwd());
  const png=await renderAdPng(engine,variant,undefined,{referenceDataUrl,detailDataUrl});
  const raw=await sharp(png).removeAlpha().raw().toBuffer();
  const pixel=(x,y)=>[...raw.subarray((1080*y+x)*3,(1080*y+x)*3+3)];
  const background=[22,54,68];
  assert.deepEqual(pixel(135,365),background,"neighboring red graphic must not enter the contain margin");
  assert.deepEqual(pixel(255,365),[51,119,221],"the selected right-hand crop is visible");
  assert.deepEqual(pixel(255,292),[51,119,221],"the yellow strip above the selected crop must stay outside");
  assert.deepEqual(pixel(405,365),background,"transparent pixels reveal the reference underneath");
  assert.deepEqual(pixel(620,300),background,"circle clips the square corner");
  assert.deepEqual(pixel(610,432),[210,50,71],"cover fills the side of the avatar with the left-hand crop");
  const panel = {...label,x:55,y:25,w:30,h:30,fill:"#efefef"};
  const overlay = {...variant,referenceLayout:{...variant.referenceLayout,body:panel}};
  const badge = await sharp(await renderAdPng(engine,overlay,undefined,{referenceDataUrl,detailDataUrl})).removeAlpha().raw().toBuffer();
  assert.deepEqual([...badge.subarray((1080*432+610)*3,(1080*432+610)*3+3)],[210,50,71],"text panel fill must not hide its inset graphic");
  await assert.rejects(renderAdPng(engine,variant,undefined,{referenceDataUrl}),/디테일|장식|이미지|원본/);

  const photoLayout={...layout,photo:{x:0,y:65,w:20,h:10},
    master:{...master,detailSlots:slots.map(slot=>({...slot,source:"photo"}))}};
  assert.equal(isReferenceLayout(photoLayout),true);
  assert.equal(usesReferenceDetailAsset(photoLayout),false);
  const photoVariant={...variant,detailAsset:undefined,asset:variant.detailAsset,referenceLayout:photoLayout};
  const copyPhoto=await renderAdPng(engine,photoVariant,detailDataUrl,{referenceDataUrl});
  const copied=await sharp(copyPhoto).removeAlpha().raw().toBuffer();
  assert.ok(raw.subarray(0,1080*650*3).equals(copied.subarray(0,1080*650*3)),"selected crops can also reuse the primary project image");

  async function ctaInk(weight) {
    const referenceLayout={...layout,master:{...master,detailSlots:[]},cta:{...layout.cta,weight,fontSize:46}};
    const text={...variant,detailAsset:undefined,referenceLayout,copy:{...variant.copy,cta:"디테일 검사"}};
    const png=await renderAdPng(engine,text,undefined,{referenceDataUrl});
    const ink=await sharp(png).extract({left:108,top:910,width:864,height:100}).greyscale().raw().toBuffer();
    return ink.reduce((n,pixel)=>n+Number(pixel>195),0);
  }
  assert.ok(await ctaInk(900) > 1.2*await ctaInk(400),"a bold reference bubble must keep its letter weight in the actual PNG");
});

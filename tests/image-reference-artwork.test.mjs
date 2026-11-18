import assert from "node:assert/strict";
import test from "node:test";
import { approveImageFormat, attachReferencePhoto, confirmReferenceCopy, createImageBatch, emptyImageCreative, imageVariantProblems,
  normalizeImageRequest, referencePhotoPending, returnImageReview, reviewImageBatch, reviseImageDesign, startImageCopyBatch } from "../lib/image-creative/model.ts";
import { selectedReferencePlan } from "../lib/image-creative/direction.ts";
import { draftReferenceLayout, isReferenceLayout, referenceCopyProblems } from "../lib/image-creative/reference-layout.ts";

const layout = {...draftReferenceLayout({path:"demo/reference.png",w:1080,h:1080}),reproduction:"image-ai"};
const stamp = {by:"tester",at:"2026-11-17T01:00:00Z"};
const output = {runId:"output",target:"render-pc"};
const copy = {headline:"나에게 딱 맞는 일은 뭘까?",body:"내 강점 보고서를 확인하세요.",cta:"내 강점 확인하기"};
const context = {now:stamp.at,by:stamp.by,newId:()=>crypto.randomUUID()};
const artwork = index => ({image:{path:`demo/artwork-${index}.png`,w:1080,h:1080},model:"test-image",inputHash:"a".repeat(64)});
function setup() {
  const base=emptyImageCreative();
  base.brief={brand:"마이인",product:"진단",offer:"결과",audience:"직장인",objective:"검사",funnel:"무료",facts:""};
  base.formatRecommendation=selectedReferencePlan(base.brief,"appeal","square",[{id:"a",meaning:"나에게 맞는 일"},{id:"b",meaning:"숨겨진 강점"}]);
  const request={mode:"appeal",count:2,size:"square",formatIds:["reference_image"],referenceLayout:layout};
  const approved=approveImageFormat(base,request,stamp);
  const copies=[copy,{...copy,headline:"아직 모르는 내 강점은 뭘까?"}];
  const made=createImageBatch(approved,request,{copies},context);
  const started=startImageCopyBatch(approved,made,request);
  return confirmReferenceCopy(started,started.batches[0].id,copies,stamp);
}
function completed(state) {
  const generated={...state,variants:state.variants.map((v,i)=>({...v,referenceArtwork:artwork(i)}))};
  const id=generated.batches.at(-1).id;
  return reviewImageBatch(reviewImageBatch(generated,id,"preview",stamp,output),id,"final",stamp,output);
}

test("AI reference copy is approved without a replacement photo, but preview requires a separately saved artwork",()=>{
  const state=setup(), v=state.variants[0], batch=state.batches[0];
  assert.ok(isReferenceLayout(layout));
  assert.equal(isReferenceLayout({...layout,reproduction:"unknown"}),false);
  assert.ok(batch.review.copy);
  assert.equal(referencePhotoPending(state,batch),false);
  assert.deepEqual(imageVariantProblems(v,true),[]);
  assert.match(imageVariantProblems(v).join(),/시안을 먼저/);
  assert.throws(()=>reviewImageBatch(state,batch.id,"preview",stamp,output),/시안을 먼저/);
  assert.deepEqual(referenceCopyProblems(layout,{...copy,headline:"긴 카피 ".repeat(12)}),[],"AI artwork never uses draft box geometry");
  assert.ok(imageVariantProblems({...v,copy:{...copy,headline:"긴".repeat(101)}},true).length,"copy length is still bounded");
  const ready={...v,referenceArtwork:artwork(0)};
  assert.deepEqual(imageVariantProblems(ready),[]);
  for (const changed of [
    {...ready.referenceArtwork,inputHash:"invalid"},
    {...ready.referenceArtwork,image:{...ready.referenceArtwork.image,w:100}},
    {...ready.referenceArtwork,image:layout.source},
  ]) assert.ok(imageVariantProblems({...ready,referenceArtwork:changed}).length);
  assert.equal(completed(state).batches[0].review.final.runId,output.runId);
});

test("an approved generated reference can continue A/B tests without inheriting a stale bitmap",()=>{
  const state=completed(setup()), winner=state.variants[0];
  const request={mode:"copy",baseId:winner.id,count:1,copyFields:["headline"]};
  assert.equal(normalizeImageRequest(state,request).referenceLayout.reproduction,"image-ai");
  const approved=approveImageFormat(state,request,stamp);
  const made=createImageBatch(approved,request,{variants:[{copy:{headline:"내 강점이 맞는 일은?"}}]},context);
  const next=made.variants.at(-1);
  assert.equal(next.parentId,winner.id);
  assert.equal(next.referenceArtwork,undefined);
  assert.equal(next.promptEdit,undefined);
  assert.deepEqual(next.referenceLayout,winner.referenceLayout);
  assert.equal(next.copy.cta,winner.copy.cta);
  assert.ok(imageVariantProblems(next).some(s=>s.includes("시안을 먼저")));
  assert.deepEqual(state.variants[0].referenceArtwork,winner.referenceArtwork,"old result is preserved");
  const copyBatch=made.batches.at(-1);
  const copyApproved=reviewImageBatch(startImageCopyBatch(approved,made,request),copyBatch.id,"copy",stamp);
  const copyReady=completed(copyApproved), copyWinner=copyReady.variants.at(-1);
  const pictures=[{path:"demo/option-a.png",w:640,h:480},{path:"demo/option-b.png",w:640,h:480}];
  const imageRequest={mode:"image",baseId:copyWinner.id,count:2,assetPaths:pictures.map(p=>p.path)};
  const imageApproved=approveImageFormat(copyReady,imageRequest,stamp);
  const imageBatch=createImageBatch(imageApproved,imageRequest,{variants:pictures.map(asset=>({asset}))},context);
  assert.ok(imageBatch.variants.slice(-2).every(v=>!v.referenceArtwork && !v.promptEdit));
  assert.deepEqual(imageBatch.variants.slice(-2).map(v=>v.copy),[copyWinner.copy,copyWinner.copy]);
});

test("replacing common source material invalidates artwork and legacy design edits cannot silently recompose it",()=>{
  const pending=setup(), state={...pending,variants:pending.variants.map((v,i)=>({...v,referenceArtwork:artwork(i)}))};
  const batch=state.batches[0], v=state.variants[0];
  const changed=attachReferencePhoto(state,batch.id,{path:"demo/photo.png",w:600,h:600});
  assert.ok(changed.variants.every(row=>!row.referenceArtwork && row.asset.path==="demo/photo.png"));
  assert.deepEqual(changed.variants.map(row=>row.copy),state.variants.map(row=>row.copy));
  assert.equal(attachReferencePhoto(changed,batch.id,{path:"demo/photo.png",w:600,h:600}),changed);
  assert.throws(()=>attachReferencePhoto(state,batch.id,layout.source),/서로 다른/);
  assert.throws(()=>reviseImageDesign(state,v.id,crypto.randomUUID(),{font:"serif",card:"paper",placement:"feed-square"},context),/요청 문구/);
  const returned=returnImageReview(state,batch.id,"copy","카피 다시 확인",stamp);
  assert.ok(returned.variants.every(row=>!row.referenceArtwork));
  assert.equal(returned.batches[0].review.copy,undefined);
});

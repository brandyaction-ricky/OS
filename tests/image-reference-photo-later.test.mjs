import assert from "node:assert/strict";
import test from "node:test";
import { approveImageFormat, attachReferencePhoto, confirmReferenceCopy, createImageBatch, emptyImageCreative, imageVariantProblems,
  referencePhotoPending, reviewImageBatch, startImageCopyBatch } from "../lib/image-creative/model.ts";
import { selectedReferencePlan } from "../lib/image-creative/direction.ts";

const box = {x:10,y:8,w:80,h:15,fill:"transparent",color:"#ffffff",fontSize:52,align:"center"};
// The same valid master layout as the reference-master test, with a photo slot.
const layout = {source:{path:"demo/master.png",w:108,h:135},photo:{x:0,y:0,w:100,h:100},
  headline:box,body:{...box,y:62,h:8},cta:{...box,y:82,h:9},
  master:{v:1,background:"#243440",regions:[{x:42,y:40,w:8,h:4,fill:"#be501c"}],headlineWeight:900,
    keepOverPhoto:[{x:18,y:30,w:66,h:23,radius:20}],bodyContinuation:{...box,y:70,h:8}}};
const copy = {headline:"새로운 하루",body:"짧은 문장 하나 두 번째 줄",cta:"시작하기"};
const stamp = {by:"tester",at:"2026-11-17T01:00:00Z"};
const photo = {path:"demo/photo.png",w:640,h:480};

function copyApproved(appeals=[{id:"a",meaning:"첫 소구"},{id:"b",meaning:"둘째 소구"}]) {
  const state = emptyImageCreative();
  state.brief = {brand:"마이인",product:"진단",offer:"결과",audience:"직장인",objective:"검사",funnel:"무료",facts:""};
  state.formatRecommendation = selectedReferencePlan(state.brief,"appeal","portrait",appeals);
  // No photo yet: the copy can come first for a design that replaces a photo.
  const request = {mode:"appeal",size:"portrait",count:2,formatIds:["reference_image"],assetPaths:[],referenceLayout:layout};
  const approved = approveImageFormat(state,request,stamp);
  const made = createImageBatch(approved,request,{copies:[copy,{...copy,headline:"다른 하루"}]},{now:stamp.at,by:stamp.by,newId:()=>crypto.randomUUID(),assets:[photo]});
  const started = startImageCopyBatch(approved,made,request);
  const batch = started.batches[0];
  return {state:confirmReferenceCopy(started,batch.id,[copy,{...copy,headline:"다른 하루"}],stamp),batchId:batch.id};
}

test("a reference design that replaces a photo takes its copy first, and the preview waits for the common photo", () => {
  const {state,batchId} = copyApproved();
  const batch = state.batches.find(b=>b.id===batchId);
  assert.ok(batch.review.copy, "copy is approved without a photo");
  assert.equal(referencePhotoPending(state,batch), true);
  assert.ok(imageVariantProblems(state.variants[0]).length > 0, "the strict check still asks for the photo before any render");
  assert.throws(()=>reviewImageBatch(state,batchId,"preview",stamp,{runId:"r1",target:"render-pc"}), /공통 사진/);

  const withPhoto = attachReferencePhoto(state,batchId,photo);
  const variants = withPhoto.batches[0].variantIds.map(id=>withPhoto.variants.find(v=>v.id===id));
  assert.ok(variants.every(v=>v.asset.path===photo.path && v.asset.w===640), "every variant takes the same photo");
  assert.deepEqual(withPhoto.batches[0].assetPaths,[photo.path]);
  assert.deepEqual(variants.map(v=>v.copy.headline),["새로운 하루","다른 하루"], "approved copy is untouched");
  assert.equal(referencePhotoPending(withPhoto,withPhoto.batches[0]), false);
  assert.deepEqual(imageVariantProblems(variants[0]),[]);

  const previewed = reviewImageBatch(withPhoto,batchId,"preview",stamp,{runId:"r1",target:"render-pc"});
  assert.ok(previewed.batches[0].review.preview);
  // The photo can change until the preview is confirmed, never after it.
  assert.ok(attachReferencePhoto(withPhoto,batchId,{path:"demo/other.png",w:300,h:300}));
  assert.throws(()=>attachReferencePhoto(previewed,batchId,{path:"demo/other.png",w:300,h:300}), /미리보기/);
  // The reference original itself is not a replacement photo.
  assert.throws(()=>attachReferencePhoto(state,batchId,{...layout.source}), /레퍼런스와 다른/);
});

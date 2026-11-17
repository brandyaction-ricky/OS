import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyImagePromptEdit, createImageBatch, emptyImageCreative, imageExperimentCandidateIds, imageExperimentSummary,
  imageVariantProblems, normalizeImageRequest, recordImageWinner, reviewImageBatch, reviseImageDesign } from "../lib/image-creative/model.ts";

const originalStamp = {by:"original-reviewer", at:"2026-11-15T01:00:00.000Z"};
const context = {by:"editor", now:"2026-11-16T01:00:00.000Z"};
const image = {path:"demo/prompt-edited.png", w:1080, h:1350};
const edit = {prompt:"이미지 오른쪽 숫자를 5로 바꿔 주세요.", model:"image-edit-subscription", image};

function reviewedState() {
  const sourceImage = {path:"demo/source.png", w:1080, h:1350};
  let state = createImageBatch({...emptyImageCreative(), brief:{objective:"무료 진단 시작", funnel:"첫 방문", audience:"강점을 알고 싶은 사람",
    product:"강점 진단", offer:"무료 결과", facts:"무료 진단"}},
  {mode:"appeal", count:1, formatIds:["photo_headline"], assetPaths:[sourceImage.path]},
  {variants:[{formatId:"photo_headline", formatVersion:1, size:"portrait", asset:sourceImage,
    appeal:{id:"strength",meaning:"내 강점을 확인하고 싶다"}, copy:{headline:"내 강점은?", body:"무료 결과로 확인해요", cta:"무료로 확인하기"}}]},
  {by:originalStamp.by, now:originalStamp.at, newId:randomUUID, assets:[sourceImage]});
  const batchId = state.batches[0].id, sourceId = state.variants[0].id;
  const output = {runId:randomUUID(), target:"local"};
  for (const step of ["format", "copy", "preview", "final"])
    state = reviewImageBatch(state,batchId,step,originalStamp,["preview","final"].includes(step) ? output : undefined);
  state = recordImageWinner(state,batchId,sourceId,"기존 결과",originalStamp);
  state.selectedId = sourceId;
  return state;
}

test("applying the reviewed image preserves the original, history, winner and selection and creates fresh content approvals", () => {
  const state = reviewedState(), before = structuredClone(state), id = randomUUID();
  const result = applyImagePromptEdit(state,state.variants[0].id,id,edit,context,[image]);
  const revision = result.variants.at(-1), batch = result.batches.at(-1);
  assert.deepEqual(state,before);
  assert.deepEqual(result.variants[0],before.variants[0]);
  assert.deepEqual(result.batches[0],before.batches[0]);
  assert.equal(result.selectedId,before.selectedId);
  assert.equal(revision.parentId,state.variants[0].id);
  for (const field of ["copy","appeal","formatId","formatVersion","size","asset","design"])
    assert.deepEqual(revision[field],before.variants[0][field]);
  assert.deepEqual(revision.promptEdit,edit);
  assert.equal(batch.baseId,revision.parentId);
  assert.equal(batch.mode,"standalone");
  assert.equal(batch.designRevision,undefined);
  assert.deepEqual(batch.variantIds,[id]);
  const stamp = {by:context.by,at:context.now};
  assert.deepEqual(batch.review,{format:stamp,copy:stamp,history:[
    {...stamp,step:"format",decision:"approved"},{...stamp,step:"copy",decision:"approved"},
  ]});
  revision.copy.headline = "수정본에만 있는 메모";
  revision.asset.w = 10;
  assert.deepEqual(result.variants[0],before.variants[0]);
  assert.deepEqual(edit,{prompt:"이미지 오른쪽 숫자를 5로 바꿔 주세요.",model:"image-edit-subscription",image});
});

test("retrying the full same edit is idempotent while changed content, model, image or base with the same ID conflicts", () => {
  const state = reviewedState(), id = randomUUID(), sourceId = state.variants[0].id;
  const result = applyImagePromptEdit(state,sourceId,id,edit,context,[image]);
  assert.equal(applyImagePromptEdit(result,sourceId,id,{image:{h:1350,w:1080,path:image.path},model:edit.model,prompt:edit.prompt},
    {...context,now:"2026-11-17T01:00:00.000Z"},[image]),result);
  const other = {path:"demo/other-edit.png",w:1080,h:1350};
  for (const changed of [{...edit,prompt:"숫자를 6으로 바꿔 주세요."},{...edit,model:"other-model"},{...edit,image:other}])
    assert.throws(()=>applyImagePromptEdit(result,sourceId,id,changed,context,[image,other]),{code:"IMAGE_REVISION_CONFLICT"});
  assert.throws(()=>applyImagePromptEdit(result,id,id,edit,context,[image]),{code:"IMAGE_REVISION_CONFLICT"});
  assert.throws(()=>applyImagePromptEdit({...state,batches:[...state.batches,{...state.batches[0],id}]},sourceId,id,edit,context,[image]),
    {code:"IMAGE_REVISION_CONFLICT"});
});

test("the edit must be registered with exact dimensions, valid bounded fields and an approved source", () => {
  const state = reviewedState(), before = structuredClone(state), sourceId = state.variants[0].id;
  const apply = (patch, assets=[image], current=state) => applyImagePromptEdit(current,sourceId,randomUUID(),patch,context,assets);
  assert.throws(()=>apply(edit,[]),{code:"IMAGE_ASSET_NOT_OWNED"});
  assert.throws(()=>apply(edit,[{...image,w:1000}]),{code:"IMAGE_ASSET_NOT_OWNED"});
  const wrongSize = {...image,w:1024,h:1280};
  assert.throws(()=>apply({...edit,image:wrongSize},[wrongSize]),{code:"IMAGE_PROMPT_EDIT_SIZE"});
  for (const patch of [{...edit,prompt:" "},{...edit,prompt:"a".repeat(2001)},{...edit,model:""},{...edit,model:"a".repeat(101)},
    {...edit,extra:"untrusted"},{...edit,image:{...image,path:"https://external.test/image.png"}},
    {...edit,image:{...image,w:1080.5}},{...edit,image:{...image,sha256:"untrusted"}}])
    assert.throws(()=>apply(patch));
  const unapproved = structuredClone(state);
  delete unapproved.batches[0].review.copy;
  assert.throws(()=>apply(edit,[image],unapproved),{code:"IMAGE_COPY_APPROVAL_REQUIRED"});
  assert.throws(()=>applyImagePromptEdit(state,sourceId,randomUUID(),edit,{...context,now:"invalid"},[image]));
  assert.deepEqual(state,before);
});

test("full-image validation checks the edited pixels without applying the inherited template's old text fit constraints", () => {
  const source = reviewedState().variants[0];
  const historical = {...source,copy:{...source.copy,headline:"긴".repeat(80)}};
  assert.ok(imageVariantProblems(historical).length);
  assert.deepEqual(imageVariantProblems({...historical,promptEdit:edit}),[]);
  for (const invalid of [{...edit,image:{...image,h:1080}},{...edit,prompt:""},{...edit,model:"x".repeat(101)}])
    assert.ok(imageVariantProblems({...source,promptEdit:invalid}).length);
});

test("a prompt-edited image cannot enter an existing A/B round or reuse obsolete copy for another test or legacy design edit", () => {
  const state = reviewedState(), batch = state.batches[0], id = randomUUID();
  const result = applyImagePromptEdit(state,state.variants[0].id,id,edit,context,[image]);
  assert.deepEqual(imageExperimentCandidateIds(result,batch),imageExperimentCandidateIds(state,batch));
  assert.deepEqual(imageExperimentSummary(result),imageExperimentSummary(state));
  assert.throws(()=>recordImageWinner(result,batch.id,id,"수정본",originalStamp),{code:"IMAGE_WINNER_INVALID"});
  for (const mode of ["appeal","copy","image"])
    assert.throws(()=>normalizeImageRequest(result,{mode,count:1,baseId:id}),{code:"IMAGE_PROMPT_EDIT_TEST_UNSUPPORTED"});
  assert.throws(()=>reviseImageDesign(result,id,randomUUID(),{font:"serif",card:"paper",placement:"feed-portrait"},context),
    {code:"IMAGE_PROMPT_EDIT_DESIGN_UNSUPPORTED"});
});

test("subsequent prompt edits keep their immediate before image and exact 1440-pixel story output dimensions", () => {
  let state = reviewedState();
  const designId = randomUUID();
  state = reviseImageDesign(state,state.variants[0].id,designId,{font:"serif",card:"paper",placement:"story",outputWidth:1440},context);
  const batchId = state.batches.at(-1).id;
  for (const step of ["format","copy"]) state = reviewImageBatch(state,batchId,step,{by:context.by,at:context.now});
  const large = {path:"demo/large.png",w:1440,h:2560}, firstId = randomUUID();
  state = applyImagePromptEdit(state,designId,firstId,{...edit,image:large},context,[large]);
  const second = {path:"demo/second.png",w:1440,h:2560};
  const result = applyImagePromptEdit(state,firstId,randomUUID(),{...edit,image:second},context,[large,second]);
  assert.deepEqual(result.variants.at(-2).promptEdit.image,large);
  assert.deepEqual(result.variants.at(-1).promptEdit.image,second);
  assert.equal(result.variants.at(-1).parentId,firstId);
  assert.deepEqual(result.variants.at(-1).design,result.variants.at(-2).design);
  assert.deepEqual(imageVariantProblems(result.variants.at(-1)),[]);
  assert.throws(()=>applyImagePromptEdit(state,firstId,randomUUID(),edit,context,[image]),{code:"IMAGE_PROMPT_EDIT_SIZE"});
});

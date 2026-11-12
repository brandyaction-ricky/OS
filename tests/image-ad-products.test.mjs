import test from "node:test";
import assert from "node:assert/strict";
import { imageAdProductsFromCanon, IMAGE_PRODUCT_CANON_TITLES } from "../lib/image-creative/products.ts";

const [channel, target, registry] = IMAGE_PRODUCT_CANON_TITLES;
const document = (id,title,content_md,version=1) => ({id,title,content_md,status:"canonical",current_version:version});
const channelDoc = document("channel",channel,`
## 12. myinlab 개발 상품 기준과 출시 준비
### 확인 범위와 적용
| 구성 | 어드민 확인 가격 | 제공 내용·확인 범위 |
|---|---|---|
| 무료 진단 | 표시에 쓰지 않는 가격 | 기록 |
| 업(業) 방향 진단 — 정밀 | 표시 제외 | 가입자용 보고서 |
### 17.2 상품과 구매 설득의 실제 근거
| 항목 | 실제 확인 |
|---|---|
| 무료 결과 | 공개된 견본의 요약 |
| 정밀 공개 견본 | 보장할 수 없는 추가 장면 |
### 15.2 무료·정밀 두 경로의 역할
| 계약 | F: 무료 경험 경로 | P: 정밀 직접 경로 |
|---|---|---|
| 기본 동선 | 예시 1 | 예시 2 |
### 15.3 화면별 설계와 구매 연결
| 화면 | 주 행동 |
|---|---|
| 무료 소개 | 무료 시작 |
| 정밀 소개 | 정밀 신청 |
`);
const audienceDoc = document("audience",target,`
## 과거 기록
### 타겟 우선순위
| 구분 | 대상 |
|---|---|
| 주력 타겟 | 옛 정의 |

## 마이인 핵심 타겟·포지셔닝·메시지
### 타겟 우선순위
| 구분 | 대상 |
|---|---|
| **주력 타겟** | 새 직원 교육 중인 팀 |
`,2);
const table = `## 상품 목록

| 상품 ID | 브랜드 | 상품 | 타겟 | 제공 내용 |
|---|---|---|---|---|
| lab | 꽃 | 꽃 수업 | 첫 방문자 | 초급 수업 |
| bad | 꽃 | 없는 값 |  | |
`;

test("추천 브리프가 최신 정본 표에서 타겟·제공 내용을 읽고 무료 견본과 실제 제공 내용을 구분한다", () => {
  const [free,paid] = imageAdProductsFromCanon([channelDoc,audienceDoc]);
  assert.equal(free.offer,"공개 결과 견본 기준 · 공개된 견본의 요약");
  assert.equal(paid.offer,"가입자용 보고서");
  assert.equal(free.audience,"새 직원 교육 중인 팀");
  assert.equal(free.funnel,"무료 경험 경로");assert.equal(paid.objective,"정밀 신청");
  assert.equal(free.source.version,1);assert.equal(paid.audienceSource.version,2);
  const updated={...audienceDoc,current_version:3,content_md:audienceDoc.content_md.replace("새 직원 교육 중인 팀","교육을 준비하는 팀")};
  assert.equal(imageAdProductsFromCanon([channelDoc,updated])[0].audience,"교육을 준비하는 팀");
  assert.deepEqual(imageAdProductsFromCanon([channelDoc]),[]);
  assert.deepEqual(imageAdProductsFromCanon([channelDoc,{...audienceDoc,status:"draft"}]),[]);
});

test("등록부의 새 SKU와 새 버전을 읽고 예시 코드, 중복된 정본·상품 ID, 제공 내용이 없는 행을 제외한다", () => {
  const doc=document("registry",registry,table);
  assert.deepEqual(imageAdProductsFromCanon([doc]),[{id:"catalog-lab",brand:"꽃",product:"꽃 수업",audience:"첫 방문자",offer:"초급 수업",source:{id:"registry",title:registry,version:1}}]);
  assert.deepEqual(imageAdProductsFromCanon([doc,{...doc,id:"second"}]),[]);
  assert.deepEqual(imageAdProductsFromCanon([{...doc,content_md:table.replace("| 꽃 | 꽃 수업 |","| 🌷 | 꽃 수업 |")}]),[]);
  assert.deepEqual(imageAdProductsFromCanon([{...doc,content_md:table+"| lab | 꽃 | 중복 | 대상 | 내용 |\n"}]),[]);
  assert.deepEqual(imageAdProductsFromCanon([{...doc,content_md:"```md\n"+table+"\n```"}]),[]);
});

test("직원에게 보이는 정본과 상위 문서 권한으로 상품 목록을 제한한다", async () => {
  const [{readFileSync}, {runInNewContext}, {default:ts}, accessPolicy] = await Promise.all([
    import("node:fs"), import("node:vm"), import("typescript"), import("../lib/knowledge/access.ts"),
  ]);
  function load(path, imports) {
    const exports = {};
    const file = readFileSync(new URL(path,import.meta.url),"utf8");
    const code = ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(code,{exports,require:key=>{assert.ok(key in imports,key);return imports[key];}});
    return exports;
  }
  const employee = {ownerId:"staff-a",type:"user",role:"member",memberKind:"staff",active:true,allowedStatuses:["canonical"]};
  const visibleMeta = {owner_id:"publisher",status:"canonical",parent_document_id:"private-parent",category_id:null,
    meeting_record_id:null,archived_from_status:null,archived_by:null,source:"manual",reader_scope:"all",steward_id:null};
  const parent = {...visibleMeta,id:"private-parent",status:"draft",parent_document_id:null};
  const details = {...document("list",registry,table),...visibleMeta};
  const access = load("../lib/server/knowledge-page-access.ts",{
    "./knowledge-access":{canReadDocument:accessPolicy.canReadDocument,knowledgeAccessContext:async actor=>({actor,context:{}})},
    "@/lib/supabase/server":{createServiceSupabase:()=>({from:()=>({select(cols){assert.ok(!cols.includes("content_md"));return {in:async()=>({data:[parent]})};}})})}
  });
  let bodyReads=0;
  const db = {from(key) {assert.equal(key,"os_documents");return {select(cols){return {eq(k,v){assert.equal(k,"status");assert.equal(v,"canonical");return this;},
    async in(key,values){if (cols.includes("content_md")) {bodyReads++;assert.equal(key,"id");assert.deepEqual([...values],["list"]);}
      else {assert.equal(key,"title");assert.ok(values.includes(registry));}return {data:[details]};}};}};}};
  const {readImageAdProducts} = load("../lib/server/image-ad-products.ts",{
    "@/lib/http":{ApiError:Error},"@/lib/image-creative/products":{IMAGE_PRODUCT_CANON_TITLES,imageAdProductsFromCanon},"./knowledge-page-access":access,
  });
  const actor={...employee,supabase:db};
  assert.equal((await readImageAdProducts(actor)).length,0);assert.equal(bodyReads,0);
  parent.status="canonical";assert.equal((await readImageAdProducts(actor))[0].id,"catalog-lab");
  parent.reader_scope="restricted";assert.equal((await readImageAdProducts(actor)).length,0);assert.equal(bodyReads,1);
});

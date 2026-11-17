import test from "node:test";
import assert from "node:assert/strict";
import { imageAdProductsFromCanon, withImageProductChoices, IMAGE_PRODUCT_CANON_TITLES, IMAGE_PRODUCT_OPERATING_TITLES, IMAGE_PRODUCT_OPERATING_SOURCES } from "../lib/image-creative/products.ts";

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
  const [free] = imageAdProductsFromCanon([channelDoc,audienceDoc]);
  assert.equal(free.offer,"공개 결과 견본 기준 · 공개된 견본의 요약");
  assert.equal(free.audience,"새 직원 교육 중인 팀");
  assert.equal(free.funnel,"무료 경험 경로");assert.equal(free.objective,"무료 시작");
  assert.equal(free.source.version,1);assert.equal(free.audienceSource.version,2);
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
    meeting_record_id:null,archived_at:null,archived_from_status:null,archived_by:null,source:"manual",reader_scope:"all",steward_id:null};
  const parent = {...visibleMeta,id:"private-parent",status:"draft",parent_document_id:null};
  const details = {...document("list",registry,table),...visibleMeta};
  const access = load("../lib/server/knowledge-page-access.ts",{
    "./knowledge-access":{canReadDocument:accessPolicy.canReadDocument,knowledgeAccessContext:async actor=>({actor,context:{}})},
    "@/lib/supabase/server":{createServiceSupabase:()=>({from:()=>({select(cols){assert.ok(!cols.includes("content_md"));return {in:async()=>({data:[parent]})};}})})}
  });
  let bodyReads=0;
  const db = {from(key) {assert.equal(key,"os_documents");return {select(cols){const filters=[];return {
    is(key,value){filters.push([key,[value]]);return this;},eq(key,value){filters.push([key,[value]]);return this;},in(key,values){filters.push([key,values]);return this;},
    then(resolve){const data=[details].filter(row=>filters.every(([key,values])=>values.includes(row[key])));
      if (cols.includes("content_md")) bodyReads++;
      return Promise.resolve({data}).then(resolve);},
  };}};}};
  const {readImageAdProducts} = load("../lib/server/image-ad-products.ts",{
    "@/lib/http":{ApiError:Error},"@/lib/image-creative/products":{IMAGE_PRODUCT_CANON_TITLES,IMAGE_PRODUCT_OPERATING_TITLES,imageAdProductsFromCanon,withImageProductChoices},"./knowledge-page-access":access,
  });
  const actor={...employee,supabase:db};
  assert.equal((await readImageAdProducts(actor)).filter(row=>!row.needsData).length,0);assert.equal(bodyReads,0);
  parent.status="canonical";assert.equal((await readImageAdProducts(actor)).find(row=>!row.needsData).id,"catalog-lab");
  parent.reader_scope="restricted";assert.equal((await readImageAdProducts(actor)).filter(row=>!row.needsData).length,0);assert.equal(bodyReads,1);
});


test("routed team operating documents supply distinct core and precision offers without stale channel substitution",()=>{
  const operating=(key,fields)=>({...document("source-"+key,IMAGE_PRODUCT_OPERATING_SOURCES[key].title,
    "## 0. 한눈에 보기\n\n| 항목 | 지금 운영 코드의 사실 | 근거 |\n|---|---|---|\n"+fields.map(([a,b])=>`| ${a} | ${b} | 코드 |`).join("\n")),status:"team"});
  const core=operating("core",[["이름","「핵심 상품」"],["고객에게 여는 것","맞춤 장 한 개"],["잠그는 것","나머지는 미리보기"],["보는 방식","웹"]]);
  const precise=operating("precision",[["이름","「정밀 상품」"],["분량","전체 장"],["장 순서","분석에서 행동으로"],["보는 방식","웹·파일"],["함께 주는 것","별도 해설"]]);
  const rows=imageAdProductsFromCanon([channelDoc,audienceDoc,core,precise]);
  assert.deepEqual(rows.map(row=>row.id),["myin-free","myin-core","myin-precision"]);
  assert.equal(rows[1].offer,"맞춤 장 한 개 · 나머지는 미리보기 · 웹");
  assert.equal(rows[2].offer,"전체 장 · 분석에서 행동으로 · 웹·파일 · 별도 해설");
  assert.equal(rows[1].source.id,core.id);assert.equal(rows[1].audienceSource.id,audienceDoc.id);
  assert.ok(!imageAdProductsFromCanon([audienceDoc,{...core,title:"Unapproved team document"}]).length);
  assert.ok(!imageAdProductsFromCanon([audienceDoc,{...core,status:"draft"}]).length);
  assert.ok(!imageAdProductsFromCanon([audienceDoc,core,{...core,id:"duplicate"}]).length);
  assert.ok(!imageAdProductsFromCanon([audienceDoc,{...core,content_md:"## 0. 한눈에 보기\n정보 없음"}]).length);
});

test("four MYIN choices keep unknown offers empty and unusable instead of inventing product facts",async()=>{
  const {briefForImageProduct,imageBriefMatchesProduct}=await import("../lib/image-creative/products.ts");
  const choices=withImageProductChoices(imageAdProductsFromCanon([channelDoc,audienceDoc]));
  assert.deepEqual(choices.slice(0,4).map(row=>row.id),["myin-free","myin-core","myin-precision","myin-strength"]);
  assert.ok(choices[2].needsData,"do not substitute old channel precision facts when its operating source is unreadable");
  assert.equal(choices[3].product,"강점 공략집");assert.ok(choices[3].needsData);
  assert.equal(choices[3].offer,"");assert.equal(choices[3].source.version,0);
  const brief=briefForImageProduct({product:"",audience:"",offer:"",objective:"",message:""},choices[3]);
  assert.equal(imageBriefMatchesProduct(brief,choices[3]),false);
  assert.equal(choices[0].offer,"공개 결과 견본 기준 · 공개된 견본의 요약");
});

test("the strength guide supplies its customer name and current page list, never the September price table",()=>{
  const md=["# 강점 해설집 — 상품 기획·제작 기준","","## 이번에 만드는 상품","","고객에게 보이는 상품 명칭은 **‘강점 공략집’**으로 둔다.","",
    "## 확정한 상품 구성과 가격 — 2026-09-15","","| 옵션 | 가격 |","| --- | ---: |","| TOP3 해설집 3권 | 30,000원 |","",
    "## 현행 판 v1.6 — 2026-11-03 (운영)","","운영 중인 해설집은 v1.6이다. 30권 모두 같은 구성이며, PDF 한 권은 18쪽이다.","",
    "| 쪽 | 이름 |","| --- | --- |","| 표지 | 강점 이름과 한 줄 |","| 01\\~10 | 내 모습 · 원하는 것 |","| 11 | 나만의 업 |","| 12 | 일하는 방식 |","",
    "### 2. 해설집 쪽 구성 (11\\~13쪽)","","| 쪽 | 제목 | 담는 것 |","| -- | -- | -- |","| 11 | 다른 표 | 무시 |"].join("\n");
  const guide={...document("source-strength",IMAGE_PRODUCT_OPERATING_SOURCES.strength.title,md),status:"team"};
  const row=imageAdProductsFromCanon([channelDoc,audienceDoc,guide]).find(item=>item.id==="myin-strength");
  assert.equal(row.product,"강점 공략집");
  assert.equal(row.offer,"강점 한 개를 깊게 읽는 해설 · 한 권 18쪽, 웹에서 읽고 PDF로 받기 · 내 모습 · 원하는 것 · 나만의 업 · 일하는 방식");
  assert.doesNotMatch(row.offer,/30,000/);
  assert.equal(row.source.id,guide.id);assert.equal(row.audienceSource.id,audienceDoc.id);
  assert.equal(withImageProductChoices(imageAdProductsFromCanon([channelDoc,audienceDoc,guide]))[3].needsData,undefined);
  for (const broken of [{...guide,status:"draft"},{...guide,content_md:md.replace("PDF 한 권은 18쪽이다.","")},{...guide,content_md:md.replace(/고객에게[^\n]+/,"")}])
    assert.ok(!imageAdProductsFromCanon([channelDoc,audienceDoc,broken]).some(item=>item.id==="myin-strength"));
});

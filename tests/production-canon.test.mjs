import assert from "node:assert/strict";
import test from "node:test";
import { FACT_TEMPLATE, productFactRows } from "../lib/youtube-process/product-facts.ts";
import { mergeDelta, reviewDelta } from "../lib/youtube-script-review2.ts";
import { scriptKey, withNotePatch } from "../lib/youtube-process/stages.ts";

test("상품 정본은 날짜와 출처, 유료 범위를 채운 표만 승인 후보가 된다", () => {
  const md=FACT_TEMPLATE.replace("|  |  |  |  |  |  |  |", "| 상품 | 5만원 | 유료 | 10 | 20분 | https://example.org | 2026-11-01 |");
  assert.equal(productFactRows(md).length,1);
  for (const invalid of [FACT_TEMPLATE, md.replace("5만원",""), md.replace("11-01","02-31"), md.replace("https:","file:"), md+"\n"+md]) assert.deepEqual(productFactRows(invalid),[]);
});

test("변경 문단만 새 검수를 반영하고 번호가 옮겨진 이전 지적을 보존한다", () => {
  const issue = { paragraph: 2, grade: "상", quote:"b", reason:"개선", fix:"b2" };
  const old = {state:"done",paragraphKeys:["a","b","c"],gates:[{gate:2,pass:false,items:[issue]}],doubts:[]};
  const delta = reviewDelta(old, ["new","a","b","c"]);
  assert.deepEqual(delta.changed,[1]);
  const merged = mergeDelta(old,{gates:[{gate:2,pass:true,items:[]}],doubts:[]},delta);
  assert.equal(merged.pass,false); assert.equal(merged.gates[0].items[0].paragraph,3);
});

test("검수 지적은 같은 원고에서 한 번 결정하며 무시는 구간 의견 작업에 보내지 않는다", () => {
  const outline = {script:"문단",versions:[]};
  const patch={note:{quote:"문단",before:"",after:"",text:"기획에서 승인한 표현",decision:{key:scriptKey("문단"),issue:"12345678",action:"ignore"}}};
  const result=withNotePatch(outline,patch,"검수자","t","one");
  assert.equal(result.notes[0].state,"dismissed");
  assert.throws(()=>withNotePatch(result,patch,"검수자","t","two"),/이미 결정/);
  assert.throws(()=>withNotePatch({...outline,script:"바뀐 문단"},patch,"검수자","t","two"),/원고가 바뀌/);
});

test("상품 정본 등록·재조회·버전 충돌·담당자 해제를 서버 경로에서 처리한다", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const { default: ts } = await import("typescript");
  const content = FACT_TEMPLATE.replace("|  |  |  |  |  |  |  |", "| 예시 | 1만원 | 유료 | 2 | 5분 | https://example.org | 2026-11-01 |");
  const doc = { id:"document", title:"상품 사실 정본", current_version:3, content_md:content, steward_id:"editor", status:"canonical", reader_scope:"all", owner_only:false, meeting_record_id:null };
  const rows = { os_documents:[doc], os_profiles:[{id:"editor",display_name:"담당자",is_active:true}], os_records:[] };
  const db = { from(table) {
    const filters = [];
    let insert, update;
    const query = {
      select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
      is(key, value) { return query.eq(key, value); },
      insert(value) { insert = value; return query; }, update(value) { update = value; return query; },
      async maybeSingle() {
        const selected = rows[table].find(row => filters.every(match => match(row)));
        if (insert && rows[table].some(row=>row.id===insert.id)) return {error:{code:"23505"}};
        if (insert) rows[table].push({...insert, version:1});
        if (update && selected) Object.assign(selected, update, {version:selected.version+1});
        return {data:insert ? {version:1} : selected ?? null, error:null};
      },
    };
    return query;
  }};
  class ApiError extends Error { constructor(status, code, message){super(message);this.code=code;this.status=status;} }
  const modules = {"@/lib/http":{ApiError}, "@/lib/supabase/server":{createServiceSupabase:()=>db}, "@/lib/youtube-process/product-facts":{productFactRows}, "./youtube-process-stages":{ypUuid:()=>"registry"}};
  const entry = await readFile(new URL("../lib/server/production-canon.ts",import.meta.url),"utf8");
  const compiled = {exports:{}};
  runInNewContext(ts.transpileModule(entry,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module:compiled,exports:compiled.exports,require:key=>modules[key]});
  const server=compiled.exports, admin={type:"user",role:"admin",id:"manager",ownerId:"manager",team:""};
  await assert.rejects(server.productJobFacts(),{code:"PRODUCT_FACTS_REQUIRED"});
  await assert.rejects(server.assignProductCanon({...admin,role:"member"},doc.id,0),{status:403});
  doc.reader_scope="restricted";
  await assert.rejects(server.assignProductCanon(admin,doc.id,0),{code:"PRODUCT_CANON_INVALID"});
  doc.reader_scope="all";
  const saved=await server.assignProductCanon(admin,doc.id,0);
  assert.equal(saved.version,1); assert.equal(saved.ref.version,3); assert.equal(saved.steward,"담당자");
  await assert.rejects(server.assignProductCanon(admin,doc.id,0),{code:"CANON_REGISTRY_CONFLICT"});
  assert.equal((await server.assignProductCanon(admin,doc.id,1)).version,2);
  assert.equal((await server.productRegistry()).count,1);
  assert.match((await server.productJobFacts()).text,/1만원/);
  rows.os_profiles[0].is_active=false;
  await assert.rejects(server.productJobFacts(),{code:"PRODUCT_FACTS_REQUIRED"});
});

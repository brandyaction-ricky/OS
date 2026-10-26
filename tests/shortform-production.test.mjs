import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

class ApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
async function load(file,modules){
  const source=await readFile(new URL("../"+file,import.meta.url),"utf8");
  const compiled={exports:{}};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module:compiled,exports:compiled.exports,URL,require:name=>{assert.ok(name in modules,name);return modules[name];}});
  return compiled.exports;
}
const catalog=await load("lib/shortform-diagram-catalog.ts",{"./shortform-diagram-catalog.json":{default:JSON.parse(await readFile(new URL("../lib/shortform-diagram-catalog.json",import.meta.url),"utf8"))}});
const contract=await load("lib/shortform-production.ts",{zod,"./http":{ApiError},"./shortform-diagram-catalog":catalog});
const api=await load("lib/server/shortform-production.ts",{
  "node:crypto":crypto,"@/lib/http":{ApiError},"@/lib/shortform-production":contract,
});
const results=await load("lib/content-automation-results.ts",{
  zod,"./http":{ApiError},"./shortform-production":contract,"./threads-posts":{threadsPostsProblem:()=>null},
});
const fields=await load("components/shortform-production-fields.tsx",{
  "react/jsx-runtime":jsx,"@/lib/shortform-production":contract,"@/components/cost-notice":{CostTag:"cost-tag"},
});
const brief={...contract.DEFAULT_SHORTFORM_BRIEF,mode:"direct",purpose:"ad",product:"Sample",
  audience:"New customers",goal:"See details",landingUrl:"https://example.com/product",
  evidence:"Actual product screen",assets:"Product screenshot",appeal:"A simpler workflow"};
const target=()=>({id:"sample",record_type:"content_publish",title:"Sample ad",description:"Human memo",brand:"Sample",
  status:"draft",metadata:{channel:"shorts",shortformBrief:{...brief}}});
const cuts=()=>({cuts:[
  {start:"00:00",end:"00:03",text:"Hook",note:"Product",voice:"Opening",asset:"Screenshot",missingAsset:false},
  {start:"00:03",end:"00:30",text:"Details",note:"Demo",voice:"Body and CTA",asset:"Recording",missingAsset:true},
]});
function jobFor(row,proc="shorts-cut",sub=""){
  const input=api.shortformJobInput(row,proc,sub);
  return {metadata:{proc,sub,shortformInput:input,shortformInputKey:api.shortformInputKey(input)}};
}
const code=expected=>error=>error.code===expected;

test("production mode and purpose are independent; invalid destinations and unknown fields are rejected",()=>{
  for(const mode of ["reuse","direct"])for(const purpose of ["organic","ad"])
    assert.equal(contract.parseShortformBrief({...brief,mode,purpose}).mode,mode);
  for(const landingUrl of ["javascript:alert(1)","http://example.com","https://user:pass@example.com"])
    assert.throws(()=>contract.parseShortformBrief({...brief,landingUrl}),code("SHORTFORM_LANDING_INVALID"));
  assert.throws(()=>contract.parseShortformBrief({...brief,approved:true}),code("SHORTFORM_BRIEF_INVALID"));
});
test("ad exploration allows missing proof; script needs selected appeal, proof and landing page",()=>{
  const row=target();row.metadata.shortformBrief={...brief,appeal:"",evidence:"",landingUrl:""};
  assert.equal(api.shortformJobInput(row,"shorts-cut","appeals").stage,"appeals");
  assert.throws(()=>api.shortformJobInput(row,"shorts-cut",""),code("SHORTFORM_INPUT_REQUIRED"));
  row.metadata.shortformBrief.appeal="Hypothesis";
  assert.throws(()=>api.shortformJobInput(row,"shorts-cut",""),code("SHORTFORM_INPUT_REQUIRED"));
  row.metadata.shortformBrief={...brief,purpose:"organic",appeal:"",product:"",landingUrl:"",evidence:""};
  assert.equal(api.shortformJobInput(row,"shorts-cut","").stage,"cuts");
});
test("only draft shortform cards can create production jobs; other processes keep their contract",()=>{
  for(const change of [{status:"ready"},{status:"review"},{record_type:"content_topic"}])
    assert.throws(()=>api.shortformJobInput({...target(),...change},"shorts-cut",""),code("SHORTFORM_TARGET_INVALID"));
  const row=target();row.metadata.channel="threads";
  assert.throws(()=>api.shortformJobInput(row,"shorts-cut",""),code("SHORTFORM_TARGET_INVALID"));
  assert.equal(api.shortformJobInput(row,"threads",""),null);
});
test("job snapshot includes memo and brief and stale results cannot replace newer production choices",()=>{
  const row=target(),job=jobFor(row);
  assert.equal(job.metadata.shortformInput.description,"Human memo");
  api.assertShortformJobCurrent({...row,version:99},job);
  for(const key of ["audience","evidence","assets","appeal"]){
    const changed=target();changed.metadata.shortformBrief[key]+=" changed";
    assert.throws(()=>api.assertShortformJobCurrent(changed,job),code("SHORTFORM_INPUT_CHANGED"));
  }
  assert.throws(()=>api.assertShortformJobCurrent({...row,description:"Other memo"},job),code("SHORTFORM_INPUT_CHANGED"));
  const captionJob=jobFor(row,"shorts-desc");
  row.metadata.cuts=cuts().cuts;
  assert.throws(()=>api.assertShortformJobCurrent(row,captionJob),code("SHORTFORM_INPUT_CHANGED"));
});
test("legacy cards remain usable but old unsnapshotted results cannot populate a new production brief",()=>{
  const legacy=target();delete legacy.metadata.shortformBrief;
  assert.equal(api.shortformJobInput(legacy,"shorts-cut","").shortformBrief,null);
  api.assertShortformJobCurrent(legacy,{metadata:{proc:"shorts-cut"}});
  assert.throws(()=>api.assertShortformJobCurrent(target(),{metadata:{proc:"shorts-cut"}}),code("SHORTFORM_INPUT_CHANGED"));
  assert.ok(results.parseAutomationResult("shorts-cut",{cuts:[{start:"00:03",end:"00:09",text:"Caption",note:"Screen",extra:"Ignored legacy field"}]}).cuts);
});
test("appeal and storyboard jobs reject each other's result shapes",()=>{
  const row=target(),appeals={appeals:[
    {title:"One",reason:"Reason",evidence:"",basis:"hypothesis"},
    {title:"Two",reason:"Reason",evidence:"Input proof",basis:"evidence"},
  ]};
  assert.equal(api.validateShortformJobResult(jobFor(row,"shorts-cut","appeals"),results.parseAutomationResult("shorts-cut",appeals)).appeals.length,2);
  assert.throws(()=>api.validateShortformJobResult(jobFor(row,"shorts-cut","appeals"),cuts()),code("SHORTFORM_APPEALS_INVALID"));
  assert.throws(()=>api.validateShortformJobResult(jobFor(row),appeals),code("SHORTFORM_CUTS_INVALID"));
});
test("direct timeline must cover exactly the selected length without gaps, overlaps or missing production fields",()=>{
  assert.equal(api.validateShortformJobResult(jobFor(target()),results.parseAutomationResult("shorts-cut",cuts())).cuts[1].voice,"Body and CTA");
  for(const patch of [{start:"00:04"},{start:"00:02"},{end:"00:31"},{end:"00:29"},{end:"00:99"},{end:"NaN"},{voice:undefined},{missingAsset:undefined}]){
    const value=cuts();value.cuts[1]={...value.cuts[1],...patch};
    assert.throws(()=>contract.validateDirectCuts(value,30),error=>error.status===422);
  }
});
test("missing materials block final review, while an assembled plan and legacy upload pass",()=>{
  const row=target();row.metadata.cuts=cuts().cuts;
  assert.throws(()=>api.validateShortformReview(row.metadata),code("SHORTFORM_ASSETS_MISSING"));
  row.metadata.cuts[1].missingAsset=false;
  api.validateShortformReview(row.metadata);
  api.validateShortformReview({channel:"shorts",mp4Path:"legacy"});
});
test("changing a production plan detaches an old video without deleting it; a new upload and legacy records survive",()=>{
  const row=target();row.metadata.mp4Path="old.mp4";row.metadata.cuts=cuts().cuts;
  const metadata={...row.metadata,shortformBrief:{...brief,appeal:"Different offer"}};
  assert.equal(api.invalidateShortformVideo(row,metadata).mp4Path,"");
  assert.equal(row.metadata.mp4Path,"old.mp4");
  assert.equal(api.invalidateShortformVideo(row,{...metadata,mp4Path:"replacement.mp4"}).mp4Path,"replacement.mp4");
  assert.equal(api.invalidateShortformVideo(row,{...row.metadata,coverText:"New cover"}).mp4Path,"old.mp4");
  assert.equal(api.invalidateShortformVideo(row,row.metadata,"Changed narration").mp4Path,"");
  assert.equal(api.invalidateShortformVideo(row,{channel:"shorts",mp4Path:"old.mp4"}).mp4Path,"old.mp4");
});
test("direct ad fields and shot editor expose user-facing choices without claiming automatic rendering",()=>{
  const html=renderToStaticMarkup(fields.ShortformProductionFields({metadata:{shortformBrief:brief},onChange:()=>{},onAppeals:()=>{}}));
  for(const label of ["제작 방식","영상 용도","내 AI로 구매 이유 후보 받기","선택한 구매 이유","MP4"])
    assert.ok(html.includes(label));
  const plan=renderToStaticMarkup(fields.ShortformCutEditor({value:JSON.stringify(cuts().cuts),onChange:()=>{}}));
  for(const label of ["장면 1","내레이션","사용할 소재","소재 확보 필요"])assert.ok(plan.includes(label));
});

test('all seventy portrait templates validate, scale to short cuts and reject unknown fields',()=>{
 assert.equal(catalog.DIAGRAM_CATALOG.length,70);
 for(const entry of catalog.DIAGRAM_CATALOG){
  const d=catalog.defaultDiagram(entry.type,3);
  assert.equal(contract.shortformDiagramSchema.safeParse(d).success,true,entry.type);
  assert.equal(contract.shortformDiagramSchema.safeParse({...d,scene:{...d.scene,html:'<script>x</script>'}}).success,false,entry.type);
 }
});

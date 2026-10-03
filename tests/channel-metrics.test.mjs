import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import { CHANNEL_METRICS,dueMetricSnapshot,parseChannelMetrics,sampleSummary,compareMetricSamples } from "../lib/channel-metrics.ts";
const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
test("snapshots use bounded age windows and never backfill a missed D1 with a later count",()=>{
  const published="2026-10-01T00:00:00Z",at=days=>new Date(Date.parse(published)+days*86400000);
  for(const [age,expected] of [[-1,null],[0.9,null],[1,"d1"],[1.99,"d1"],[2,null],[7,"d7"],[8,null],[28,"d28"],[29,null]])assert.equal(dueMetricSnapshot(published,at(age)),expected);
  assert.equal(dueMetricSnapshot("invalid"),null);
});
test("metric parsing retains measured zero, omits missing/nonfinite values and excludes Instagram impressions",()=>{
  assert.equal(CHANNEL_METRICS.instagram.includes("impressions"),false);
  const result=parseChannelMetrics("instagram",[{name:"views",values:[{value:0}]},{name:"likes",total_value:{value:12}},{name:"reach",values:[]},{name:"comments",values:[{value:null}]},{name:"saved",values:[{value:Infinity}]},{name:"impressions",values:[{value:999}]}]);
  assert.deepEqual(result,{views:0,likes:12});
});
test("summary uses median/range/n and holds small or overlapping samples",()=>{
  assert.deepEqual(sampleSummary([5,1,9,3]),{n:4,median:4,min:1,max:9});
  assert.deepEqual(sampleSummary([]),{n:0,median:null,min:null,max:null});
  assert.match(compareMetricSamples([1,2,3,4],[10,20,30,40,50]),/비교 보류/);
  assert.match(compareMetricSamples([1,2,3,4,5],[5,6,7,8,9]),/차이 없음/);
  assert.match(compareMetricSamples([1,2,3,4,5],[6,7,8,9,10]),/관찰 범위 분리/);
});
test("automatic metric IDs are stable per publication/snapshot/metric and writes never overwrite manual data",async()=>{
  const source=await read("lib/server/channel-metrics.ts"),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,mod={exports:{}};
  const deps={"node:crypto":crypto,"@/lib/http":{},"@/lib/channel-metrics":{CHANNEL_METRICS,dueMetricSnapshot,parseChannelMetrics},"@/lib/supabase/server":{},"./meta-oauth":{assertMetaModeMatches:()=>{},metaMode:()=>"mock"},"./meta-collection":{}};
  runInNewContext(`(function(require,module,exports){${compiled}\n})`,{})(name=>deps[name],mod,mod.exports);
  const api=mod.exports,id=api.channelMetricId("post","threads","d1","views");
  assert.equal(id,api.channelMetricId("post","threads","d1","views"));assert.notEqual(id,api.channelMetricId("post","threads","d7","views"));assert.notEqual(id,api.channelMetricId("post","threads","d1","likes"));
  assert.match(source,/onConflict:"id",ignoreDuplicates:true/);assert.doesNotMatch(source,/\.update\(\{/);
  assert.equal((await api.collectPostMetrics({platform:"threads"},"post")).views,100);
  for(const file of ["app/api/v1/records/route.ts","app/api/v1/agent-records/route.ts"])assert.equal(((await read(file)).match(/METRIC_SNAPSHOT_READ_ONLY/g)??[]).length,3);
});

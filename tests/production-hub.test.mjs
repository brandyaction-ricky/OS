import assert from "node:assert/strict";
import test from "node:test";
import {workspaceRedirect,productionRedirect,WORKSPACE_TABS} from "../lib/workspace-tabs.ts";
import {productionStep,productionSources,productionHref} from "../lib/content-production-board.ts";
const source={id:"fixture",record_type:"content_topic",status:"backlog",metadata:{},archived_at:null};
const child=(record_type,packageKind)=>({id:record_type,record_type,parent_id:"fixture",metadata:{packageKind},archived_at:null});
test("board shows one card per own active source and derives next work from linked artifacts",()=>{
 assert.deepEqual(productionSources([source,{...source,id:"market",metadata:{origin:"market"}},{...source,id:"test",metadata:{origin:"test"}},{...source,id:"old",archived_at:"date"}]),[source]);
 const rows=[];assert.equal(productionStep(source,rows),"planning");rows.push(child("content_package","topic_plan"));assert.equal(productionStep(source,rows),"script");rows.push(child("content_script"));assert.equal(productionStep(source,rows),"package");rows.push(child("content_package","title_package"));assert.equal(productionStep(source,rows),"short");rows.push(child("content_short"));assert.equal(productionStep(source,rows),"publish");assert.equal(productionStep({...source,status:"published"},[]),"publish");
});
test("legacy redirects preserve record identifiers and repeated unrelated query values",()=>{
 assert.equal(workspaceRedirect("/home/goals",{record:"fixture",filter:["a","b"]}),"/performance/overview?record=fixture&filter=a&filter=b&tab=goals");
 assert.equal(productionRedirect("/content/packages",{sourceId:"fixture",tab:"saved"}),"/content/production?sourceId=fixture&tab=saved&step=package");
 assert.equal(productionRedirect("/content/scripts",{}),"/content/production?step=script&view=tools");assert.equal(workspaceRedirect("/unknown",{}),null);
 assert.equal(productionHref("a&b","script"),"/content/production?sourceId=a%26b&step=script");assert.equal(Object.keys(WORKSPACE_TABS).length,4);
});

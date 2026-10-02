import assert from "node:assert/strict";
import test from "node:test";
import {buildPersonalWork} from "../lib/personal-work.ts";
import {findPage,findStage} from "../lib/navigation.ts";
const row=(id,fields={})=>({id,record_type:"task",title:id,status:"planned",metadata:{},archived_at:null,assignee_id:"me",created_by:"other",due_date:null,updated_at:"2026-10-03",description:"",...fields});
test("personal tabs separate assigned work, review and requests without showing market or test rows",()=>{
 const result=buildPersonalWork([row("later"),row("soon",{due_date:"2026-10-04"}),row("review",{status:"review"}),row("done",{status:"done",created_by:"me"}),row("other",{assignee_id:"other"}),row("test",{metadata:{origin:"test"}}),row("market",{metadata:{studioKind:"outlier"}}),row("archived",{archived_at:"2026-10-01"})],[],"me");
 assert.deepEqual(result.received.map(x=>x.id),["soon","later"]);assert.deepEqual(result.review.map(x=>x.id),["review"]);assert.deepEqual(result.requested.map(x=>x.id),["done"]);
});
test("requests show centralized status and actionable hold guidance",()=>{
 const result=buildPersonalWork([row("request",{record_type:"ai_job",created_by:"me",status:"blocked",metadata:{kind:"development_request",plainSummary:"기능 수정",nextAction:"범위 확인",holdReason:"정보 대기",reviewDate:"2026-10-05"}})],[],"me");
 assert.equal(result.requested[0].status,"보류");assert.equal(result.requested[0].nextAction,"범위 확인");assert.match(result.requested[0].href,/knowledge\/development\?request=request/);
});
test("reviewed documents are returned for owners and admins, never as approval authority",()=>{
 const documents=[{id:"a",title:"A",status:"reviewed",owner_id:"other"},{id:"b",title:"B",status:"review",owner_id:"other"}];
 assert.deepEqual(buildPersonalWork([],documents,"me").review.map(x=>x.id),["b"]);assert.equal(buildPersonalWork([],documents,"me",true).review.length,2);
});
test("update history query has a distinct navigation name while request URLs remain compatible",()=>{
 assert.equal(findPage("/knowledge/development?project=fixture&tab=history").label,"업데이트 내역");assert.equal(findStage("/knowledge/development?tab=history").id,"development");assert.equal(findPage("/knowledge/development?new=request").label,"수정 요청");
});

import assert from "node:assert/strict";
import test from "node:test";
import {makeMeetingReview,meetingReviewErrors,matchMeetingAssignee,normalizeMeetingTerms,similarMeetings,decisionSource,readMeetingReview} from "../lib/meeting-review.ts";
import {assignTaskBatch,validWorkDate} from "../lib/task-management.ts";
import { customMeetingTerms, validMeetingTerms, MEETING_TERM_SETTING_KEY } from "../lib/meeting-term-settings.ts";
const members=[{id:"a",display_name:"검증자",email:"one@example.test",is_active:true},{id:"b",display_name:"검증자",email:"two@example.test",is_active:true},{id:"c",display_name:"비활성",email:"off@example.test",is_active:false}];
test("names match only a unique active member; ambiguous or inactive names stay unresolved",()=>{
 assert.equal(matchMeetingAssignee("검증자",members),"");assert.equal(matchMeetingAssignee("one",members),"a");assert.equal(matchMeetingAssignee("비활성",members),"");
});
test("task confirmation requires real assignee and a calendar date; excluded items are ignored",()=>{
 const rows=makeMeetingReview({decisions:[],pending:[],todos:[{title:"마인 안내 준비",assignee:"one",dueDate:"",dueLabel:"나중"}]},members,()=>"fixture");
 assert.equal(rows[0].title,"마이인 안내 준비");assert.equal(rows[0].assigneeId,"a");assert.equal(meetingReviewErrors(rows,members).length,1);
 rows[0].dueDate="2026-02-31";assert.equal(meetingReviewErrors(rows,members).length,1);rows[0].dueDate="2026-10-05";assert.deepEqual(meetingReviewErrors(rows,members),[]);
 assert.ok(meetingReviewErrors([...rows,...rows],members).length);rows[0].kind="excluded";rows[0].assigneeId="";assert.deepEqual(meetingReviewErrors(rows,members),[]);
 assert.equal(validWorkDate("2026-99-99"),false);assert.equal(validWorkDate(""),false);
});
test("terms do not replace substrings inside unrelated Korean words and malformed stored reviews cannot crash the editor",()=>{
 assert.equal(normalizeMeetingTerms("마인드와 마인을 자산몰에서 확인"),"마인드와 마이인을 자사몰에서 확인");assert.equal(readMeetingReview([null]),null);assert.equal(makeMeetingReview({decisions:[],pending:[],todos:[null,{title:"이전 업무"}]},members,()=>"legacy")[0].assigneeId,"");assert.equal(readMeetingReview([{kind:"task"}]),null);
});
test("company meeting glossary extends defaults without altering source text or malformed settings",()=>{
 const records=[{record_type:"company_setting",archived_at:null,metadata:{settingKey:MEETING_TERM_SETTING_KEY,terms:[{from:"핀터",to:"핀터레스트"},{from:"",to:"무효"}]}}];
 const terms=customMeetingTerms(records);
 assert.deepEqual(terms,[{from:"핀터",to:"핀터레스트"}]);
 assert.equal(normalizeMeetingTerms("마인을 핀터에서 확인",terms),"마이인을 핀터레스트에서 확인");
 assert.equal(normalizeMeetingTerms("핀터링은 유지",terms),"핀터링은 유지");
 assert.deepEqual(validMeetingTerms({terms:[]}),[]);
 const extracted={decisions:["핀터 검토"],pending:[],todos:[]};
 assert.equal(makeMeetingReview(extracted,members,()=>"id",terms)[0].title,"핀터레스트 검토");
 assert.equal(extracted.decisions[0],"핀터 검토");
});
test("duplicate suggestions use the Korean calendar day and exclude archived and the current meeting",()=>{
 const row={id:"m",title:"마이인 정기 회의",brand:"마이인",starts_at:"2026-10-02T16:00:00Z",archived_at:null};
 assert.equal(similarMeetings([row],"마이인 회의","마이인","2026-10-03").length,1);
 assert.equal(similarMeetings([row],"마이인 회의","마이인","2026-10-02").length,0);
 assert.equal(similarMeetings([row],"마이인 회의","마이인","2026-10-03","m").length,0);
});
test("decision source counts distinguish meetings, telegram, content planning and direct records",()=>{
 assert.deepEqual([{source:"meeting"},{source:"telegram"},{kind:"content_hypothesis"},{}].map(metadata=>decisionSource({metadata,source_url:null})),["meeting","telegram","planning","direct"]);
});
test("batch assignment uses expected versions, bounds concurrency and returns only failed records for retry",async()=>{
 let active=0,maximum=0;const rows=Array.from({length:6},(_,i)=>({id:String(i),version:i+1}));const inputs=[];
 const result=await assignTaskBatch(rows,"member","2026-10-05",async input=>{inputs.push(input);active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));active--;if(input.id==="2")throw new Error("conflict");});
 assert.equal(maximum,4);assert.deepEqual(result.failed,["2"]);assert.equal(result.updated.length,5);assert.equal(inputs[2].expectedVersion,3);
 await assert.rejects(assignTaskBatch(rows,"","2026-10-05",async()=>{}));await assert.rejects(assignTaskBatch(rows,"member","2026-02-31",async()=>{}));
});

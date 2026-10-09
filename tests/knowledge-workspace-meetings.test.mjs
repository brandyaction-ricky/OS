import test from "node:test";
import assert from "node:assert/strict";
import {projectMeetings,meetingDecisions,MEETING_RETENTION} from "../lib/knowledge/meetings.ts";

const actor={ownerId:"reader",type:"user",role:"member",memberKind:"staff",active:true,allowedStatuses:[]};
const old={id:"old",title:"Synthetic legacy meeting",description:"Agenda",status:"active",version:1,owner_id:"author",created_by:"author",updated_at:"2026-10-09T01:00:00Z",metadata:{transcript:"Original",summary:"Summary"}};
const decision={id:"decision",title:"Confirmed legacy decision",status:"decided",version:1,owner_id:"author",created_by:"author",created_at:"2026-10-08T01:00:00Z",updated_at:"2026-10-08T01:00:00Z",parent_id:"old",metadata:{source:"meeting"}};

test("legacy projection preserves source, decision attribution and missing review evidence",()=>{
 const before=structuredClone(old),rows=projectMeetings([old],[decision],[],actor);
 assert.deepEqual(old,before);assert.equal(rows[0].legacy,true);assert.equal(rows[0].description,"Original");
 const [{item,confirmed}]=meetingDecisions(rows);assert.equal(confirmed,true);assert.equal(item.reviewMissing,true);assert.equal(item.confirmedBy,"author");assert.equal(item.confirmedAt,decision.created_at);
 assert.equal(rows[0].status,"active");
});
test("legacy free-text names never grant partner access; private meetings do not grant admin/owner bypass",()=>{
 const named={...old,metadata:{...old.metadata,participants:"reader",visibility:"attendees"}};
 for(const who of [actor,{...actor,role:"admin"},{...actor,ownerId:"author"},{...actor,memberKind:"partner"}])assert.equal(projectMeetings([named],[decision],[],who).length,0);
 assert.equal(projectMeetings([old],[decision],[],{...actor,memberKind:"partner"}).length,0);
 assert.equal(projectMeetings([named],[decision],[{meeting_id:"old",user_id:"reader"}],{...actor,memberKind:"partner"}).length,1);
 assert.equal(projectMeetings([old],[decision],[],{...actor,type:"agent"}).length,0);
 assert.equal(projectMeetings([old],[decision],[],{...actor,active:false}).length,0);
});
test("legacy cancelled and unconfirmed decisions are omitted, missing source meetings reveal nothing",()=>{
 assert.deepEqual(projectMeetings([{...old,status:"cancelled"}],[decision],[],actor),[]);
 assert.deepEqual(projectMeetings([old],[{...decision,status:"pending"}],[],actor)[0].metadata.items,[]);
 assert.deepEqual(projectMeetings([], [decision],[],actor),[]);
});
test("new decisions exclude unaccepted AI proposals and include append-only corrections",()=>{
 const meeting={...old,metadata:{workspace:"knowledge",visibility:"team",agenda:"",items:[
  {id:"ai-pending",kind:"decision",text:"Hidden",state:"pending",source:"ai"},
  {id:"ai-accepted",kind:"decision",text:"Accepted",state:"accepted",source:"ai"},
  {id:"manual",kind:"decision",text:"Manual",state:"pending",source:"manual"},
  {id:"discarded",kind:"decision",text:"Excluded",state:"discarded",source:"manual"},
 ]}};
 const rows=projectMeetings([meeting],[],[],actor);assert.equal(rows[0].legacy,undefined);
 assert.deepEqual(meetingDecisions(rows).map(r=>r.item.id),["ai-accepted","manual"]);
 assert.equal(meetingDecisions(rows).every(r=>!r.confirmed),true);
 rows[0].status="done";rows[0].metadata.corrections=[{text:"Correction",reason:"New evidence",by:"reviewer",at:"2026-10-09T01:00:00Z"}];
 const correction=meetingDecisions(rows).at(-1);assert.equal(correction.confirmed,true);assert.equal(correction.item.correctionReason,"New evidence");assert.equal(correction.item.confirmedBy,"reviewer");
});
test("retention policy cannot claim an unconfigured deletion job is running",()=>{
 assert.equal(MEETING_RETENTION.audioDays,30);assert.equal(MEETING_RETENTION.transcriptDays,365);assert.equal(MEETING_RETENTION.automaticDeletionEnabled,false);
});

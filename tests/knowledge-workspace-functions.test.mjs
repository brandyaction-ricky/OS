import test from "node:test";
import assert from "node:assert/strict";
import { applyKnowledgeCommand as apply, createDemoKnowledge, visibleState } from "../lib/knowledge/demo.ts";
import { mergeMarkdown, mergeValue, joinMergeParts } from "../lib/knowledge/merge.ts";
import { buildKnowledgeGraph } from "../lib/knowledge-links.ts";
import { forceStep, seedPositions } from "../lib/knowledge/force.ts";
import {withIgnoredLinks} from "../lib/knowledge/ignored-links.ts";
import {visibleGraphLabels} from "../lib/knowledge/graph-labels.ts";
import {kstTime,documentPage} from "../lib/knowledge/model.ts";
import {documentMarkdown,safeExportName} from "../lib/knowledge/export.ts";
const author={ownerId:"writer",type:"user",role:"member",memberKind:"staff",active:true,canApprove:true};
const reviewer={...author,ownerId:"example-reviewer",role:"admin"};
const admin={...author,ownerId:"administrator",role:"admin"};
const partner={...author,ownerId:"example-partner",memberKind:"partner",canApprove:false};
const run=(state,command,actor=author)=>apply(state,actor,command,"2026-10-09T03:00:00Z");
const create=(state,space="mine",extra={})=>run(state,{action:"document.create",space,title:"QA 문서",content:"첫 본문",...extra});
test("demo read and write projections fail closed below hidden or cyclic ancestors",()=>{
 const state=createDemoKnowledge(author),child=state.documents[0];
 state.documents.push({...child,id:"hidden-parent",owner_id:"other",status:"draft"});child.parent_document_id="hidden-parent";
 assert.equal(visibleState(state,author).documents.some(d=>d.id===child.id),false);
 assert.throws(()=>run(state,{action:"document.export",id:child.id,format:"md",range:"doc"}));
 child.parent_document_id=child.id;assert.equal(visibleState(state,author).documents.some(d=>d.id===child.id),false);
});
test("document export includes selected history and logs no private body",()=>{
 const initial=createDemoKnowledge(author),doc=initial.documents[0];
 const next=run(initial,{action:"document.export",id:doc.id,format:"md",range:"doc_versions"}).state;
 assert.equal(next.events[0].action,"export");assert.equal(next.documents[0].current_version,doc.current_version);
 assert.deepEqual(next.events[0].detail,{format:"md",range:"doc_versions",version:doc.current_version});
 assert.match(documentMarkdown(doc,initial.versions[doc.id]),/# 버전 기록/);
 assert.doesNotMatch(documentMarkdown(doc),/# 버전 기록/);
 assert.equal(safeExportName("a/b:c"),"a_b_c.md");
 assert.throws(()=>run(initial,{action:"document.export",id:doc.id,format:"raw",range:"all"}));
});
test("large document lists stay bounded and malformed pagination is clamped",()=>{
 const rows=Array.from({length:5001},(_,i)=>i);
 assert.deepEqual(documentPage(rows,"2").rows,rows.slice(50,100));
 assert.equal(documentPage(rows,"999").page,101);
 assert.deepEqual(documentPage(rows,"999").rows,[5000]);
 for(const value of [null,"-2","NaN","Infinity","1.5"])assert.equal(documentPage(rows,value).page,1);
 assert.deepEqual(documentPage([],"4").rows,[]);
});
test("version timestamps use stable absolute KST including midnight rollover",()=>{
 assert.equal(kstTime("2026-10-08T15:00:00Z"),"2026-10-09 00:00 KST");
});

test("graph labels suppress overlap and retain selected/hovered priorities",()=>{
 const boxes=[{id:"selected",x:0,y:0,width:100,height:20,priority:0,required:true},{id:"ordinary",x:20,y:0,width:100,height:20,priority:10},{id:"far",x:300,y:100,width:100,height:20,priority:0}];
 assert.deepEqual([...visibleGraphLabels(boxes)],["selected","far"]);
});

test("partner steward can renew review but cannot demote or approve",()=>{
 const state=createDemoKnowledge(partner);state.documents.find(d=>d.id==="example-canonical").steward_id=partner.ownerId;
 const next=run(state,{action:"canon.keep",id:"example-canonical",expectedVersion:1},partner).state;
 assert.equal(next.documents.find(d=>d.id==="example-canonical").review_due_on,"2027-01-07");
 assert.throws(()=>run(next,{action:"canon.demote",id:"example-canonical",expectedVersion:1,reason:"denied"},partner));
});

test("editing and deleting built-in templates never recreates or duplicates defaults",()=>{
 let state=createDemoKnowledge(admin),builtin=state.templates[0];
 state=run(state,{action:"template.save",defaultKey:builtin.id,scope:"company",name:"수정된 기본",content:"수정 본문",defaultSpace:"mine",kind:"doc"},admin).state;
 assert.equal(state.templates.length,10);assert.equal(state.templates.some(t=>t.id===builtin.id),false);
 const replacement=state.templates.find(t=>t.default_key===builtin.id);assert.equal(replacement.body_md,"수정 본문");
 state=run(state,{action:"template.archive",id:replacement.id},admin).state;
 assert.equal(visibleState(state,admin).templates.length,9);
 assert.throws(()=>run(createDemoKnowledge(author),{action:"template.save",defaultKey:builtin.id,scope:"company",name:"금지",content:"",defaultSpace:"mine"},author));
});
test("ignored links stay hidden only until their source version changes",()=>{
 let state=createDemoKnowledge(author),doc=state.documents[0];doc.content_md="[[없는 대상]]";
 state=run(state,{action:"link.ignore",id:doc.id,target:"없는 대상"}).state;
 assert.equal(withIgnoredLinks(buildKnowledgeGraph(state.documents),state.events).broken.length,0);
 state=run(state,{action:"document.commit",id:doc.id,expectedVersion:1,title:doc.title,content:"[[없는 대상]]\n새 본문"}).state;
 assert.equal(withIgnoredLinks(buildKnowledgeGraph(state.documents),state.events).broken.length,1);
});
test("next meeting inherits attendees and agenda without changing a completed meeting",()=>{
 let created=run(createDemoKnowledge(author),{action:"meeting.create",title:"첫 회의",content:"안건",visibility:"attendees"}),state=created.state,id=created.id;
 state=run(state,{action:"meeting.start",id,expectedVersion:1}).state;
 state=run(state,{action:"meeting.finish",id,expectedVersion:2}).state;
 state=run(state,{action:"meeting.review",id,expectedVersion:3}).state;
 const next=run(state,{action:"meeting.create",title:"다음 회의",previousMeetingId:id});
 assert.equal(next.state.meetings[0].metadata.previousMeetingId,id);assert.equal(next.state.meetings[0].metadata.agenda,"안건");
 assert.equal(next.state.meetings.find(m=>m.id===id).status,"done");
});

test("draft, commit, no-op and properties have exact version semantics",()=>{
 let {state,id}=create(createDemoKnowledge(author));
 state=run(state,{action:"document.draft",id,title:"QA 문서",content:"둘째 본문",expectedVersion:1}).state;
 assert.equal(state.documents.find(d=>d.id===id).current_version,1);
 state=run(state,{action:"document.commit",id,title:"QA 문서",content:"둘째 본문",expectedVersion:1}).state;
 assert.equal(state.documents.find(d=>d.id===id).current_version,2);assert.equal(state.drafts.length,0);
 state=run(state,{action:"document.commit",id,title:"QA 문서",content:"둘째 본문",expectedVersion:2}).state;
 state=run(state,{action:"document.properties",id,workState:"done",dueOn:"2026-10-12",expectedVersion:2}).state;
 assert.equal(state.documents.find(d=>d.id===id).current_version,2);
 assert.equal(state.versions[id].length,2);
 assert.throws(()=>run(state,{action:"document.commit",id,content:"충돌",expectedVersion:1}),e=>e.code==="VERSION_CONFLICT");
 assert.equal(state.documents.find(d=>d.id===id).content_md,"둘째 본문");
});
test("daily creation is idempotent; inbox append with an open draft is atomic",()=>{
 let {state,id}=create(createDemoKnowledge(author),"mine",{dailyOn:"2026-10-09"});
 assert.equal(create(state,"mine",{dailyOn:"2026-10-09"}).id,id);
 state=run(state,{action:"document.draft",id,title:"초안",content:"초안",expectedVersion:1}).state;
 const note=run(state,{action:"inbox.create",body:"추가 메모"});state=note.state;
 assert.throws(()=>run(state,{action:"inbox.process",id:note.id,today:true}),e=>e.code==="DRAFT_CONFLICT");
 assert.equal(state.inbox[0].processed_at,undefined);
 state=run(state,{action:"document.discard",id}).state;
 state=run(state,{action:"inbox.process",id:note.id,today:true}).state;
 assert.match(state.documents.find(d=>d.id===id).content_md,/추가 메모/);
 assert.equal(visibleState(state,author).inbox.length,0);
});
test("category batch failure rolls back all names and partner cannot set shared properties",()=>{
 let state=createDemoKnowledge(author);
 const original=structuredClone(state.categories);
 assert.throws(()=>run(state,{action:"category.batch",space:"team",categories:[{...state.categories[1],name:"중복"},{...state.categories[1],id:"missing",name:"오류"}],deleted:[]}));
 assert.deepEqual(state.categories,original);
 state.categories[1].partner_ids=[partner.ownerId];
 assert.throws(()=>run(state,{action:"document.properties",id:"example-team-document",expectedVersion:1,categoryId:null},partner));
});
test("candidate approval excludes author, requires assignee or reasoned admin proxy",()=>{
 let {state,id}=create(createDemoKnowledge(author),"team");
 let candidate=run(state,{action:"candidate.submit",id,expectedVersion:1,approverId:reviewer.ownerId,reviewDueOn:"2027-01-09",stewardId:author.ownerId});state=candidate.state;
 assert.throws(()=>run(state,{action:"candidate.decide",id:candidate.id,expectedVersion:1,decision:"approved"}));
 assert.throws(()=>run(state,{action:"candidate.decide",id:candidate.id,expectedVersion:1,decision:"approved"},admin));
 state=run(state,{action:"candidate.decide",id:candidate.id,expectedVersion:1,decision:"approved"},reviewer).state;
 assert.equal(state.documents.find(d=>d.id===id).status,"reviewed");
 assert.equal(state.documents.find(d=>d.id===id).current_version,1);
 assert.throws(()=>run(state,{action:"candidate.publish",id:candidate.id,expectedVersion:1},admin));
 state=run(state,{action:"candidate.publish",id:candidate.id,expectedVersion:1},{...admin,canPublishCanonical:true}).state;
 assert.equal(state.documents.find(d=>d.id===id).status,"canonical");
});
test("metadata-only proposal creates one version and stale proposal cannot approve",()=>{
 let state=createDemoKnowledge(author);
 state.people.push({...admin,id:admin.ownerId,display_name:"관리 검토",role:"admin",member_kind:"staff",can_approve:true});
 const proposal=run(state,{action:"proposal.create",id:"example-canonical",expectedVersion:1,approverId:admin.ownerId,folder:"새 분류",reason:"분류 갱신"});state=proposal.state;
 state=run(state,{action:"proposal.decide",id:proposal.id,decision:"approved"},admin).state;
 assert.equal(state.documents.find(d=>d.id==="example-canonical").current_version,2);
 const stale=run(state,{action:"proposal.create",id:"example-canonical",expectedVersion:1,approverId:admin.ownerId,reason:"오래된 초안"});
 assert.throws(()=>run(stale.state,{action:"proposal.decide",id:stale.id,decision:"approved"},admin),e=>e.code==="VERSION_CONFLICT");
});
test("meeting lifecycle locks reviewed work and preserves notes when summary changes",()=>{
 let result=run(createDemoKnowledge(author),{action:"meeting.create",title:"회의",content:"안건"}),state=result.state,id=result.id;
 state=run(state,{action:"meeting.save",id,expectedVersion:1,content:"원문",summary:"요약",startsAt:"2026-10-12T01:00:00Z",attendees:[partner.ownerId]}).state;
 assert.equal(state.meetings[0].description,"원문");assert.equal(state.meetings[0].metadata.summary,"요약");
 state=run(state,{action:"meeting.start",id,expectedVersion:2}).state;
 state=run(state,{action:"meeting.finish",id,expectedVersion:3}).state;
 assert.throws(()=>run(state,{action:"meeting.save",id,expectedVersion:4,content:"바꿈"},partner));
 state=run(state,{action:"meeting.save",id,expectedVersion:4,items:[{id:"decision",kind:"decision",text:"결정",state:"pending"}]}).state;
 assert.throws(()=>run(state,{action:"meeting.review",id,expectedVersion:5}));
 state=run(state,{action:"meeting.save",id,expectedVersion:5,items:[{id:"decision",kind:"decision",text:"결정",state:"accepted"}]}).state;
 state=run(state,{action:"meeting.review",id,expectedVersion:6}).state;
 assert.throws(()=>run(state,{action:"meeting.save",id,expectedVersion:7,content:"덮어쓰기"}));
 state=run(state,{action:"meeting.correct",id,expectedVersion:7,content:"정정",reason:"근거 변경"}).state;
 assert.equal(state.meetings[0].description,"원문");assert.equal(state.meetings[0].metadata.corrections.length,1);
 const personalMeeting=run(state,{action:"meeting.create"},partner);assert.equal(personalMeeting.state.meetings[0].metadata.visibility,"attendees");
});
test("canonical restore stays in review, private trash stays private, purge guards retained docs",()=>{
 let state=createDemoKnowledge(author);
 state.people.push({id:admin.ownerId,display_name:"관리자",role:"admin",member_kind:"staff",can_approve:true});
 state=run(state,{action:"document.archive",id:"example-canonical",reason:"정리"},admin).state;
 assert.throws(()=>run(state,{action:"trash.purge",id:"example-canonical",reason:"삭제",confirm:true},admin));
 const restored=run(state,{action:"trash.restore",id:"example-canonical",expectedVersion:1,approverId:author.ownerId,reviewDueOn:"2027-01-09",reason:"재검토"},admin);
 assert.equal(restored.state.documents.find(d=>d.id==="example-canonical").status,"review");
 assert.equal(restored.state.candidates.length,1);
 const privateDoc=create(state);state=run(privateDoc.state,{action:"document.archive",id:privateDoc.id}).state;
 assert.equal(visibleState(state,admin).documents.some(d=>d.id===privateDoc.id),false);
});
test("templates preserve content, scope and default destination",()=>{
 const result=run(createDemoKnowledge(author),{action:"template.save",name:"내 템플릿",content:"서식",scope:"personal",defaultSpace:"meeting",kind:"meeting"});
 const template=result.state.templates.find(t=>t.id===result.id);
 assert.equal(template.body_md,"서식");assert.equal(template.default_space,"meeting");
 assert.throws(()=>run(result.state,{action:"template.save",name:"회사",content:"서식",scope:"company"}));
});
test("diff3 merges independent changes and requires overlapping conflicts",()=>{
 for(const [base,current,proposed,expected] of [
  ["a\nb\nc","A\nb\nc","a\nb\nC","A\nb\nC"],
  ["a\nb\nc","a\nc","a\nb\nC","a\nC"],
  ["a\nb","x\na\nb","a\nb\ny","x\na\nb\ny"],
  ["a\nb","a\n","A\nb","A\n"],
 ]){const parts=mergeMarkdown(base,current,proposed);assert.equal(parts.some(p=>p.conflict),false);assert.equal(joinMergeParts(parts),expected);}
 assert.equal(mergeMarkdown("a","b","c").some(p=>p.conflict),true);
 assert.deepEqual(mergeValue(["a"],["b"],["c"]).conflict,true);
});
test("5,000-document graph build is bounded and force ticks remain finite",()=>{
 const docs=Array.from({length:5000},(_,i)=>({id:String(i),title:"문서 "+i,content_md:i?"[["+String(i-1)+"]]":"",folder:"",status:"team",owner_id:"writer"}));
 const start=performance.now(),graph=buildKnowledgeGraph(docs);
 assert.equal(graph.edges.length,4999);
 assert.ok(performance.now()-start<2000,"graph build should be indexed");
 const nodes=graph.nodes.slice(0,1000),positions=seedPositions(nodes);
 for(let i=0;i<3;i++)forceStep(positions,graph.edges);
 assert.ok([...positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

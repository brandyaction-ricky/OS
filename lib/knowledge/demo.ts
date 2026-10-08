import { canReadDocument, canReadDocumentTree, canEditDocument, canManageCategory, canChangeCategory, canDecideProposal, type KnowledgeActor } from "./access.ts";
import { DEFAULT_TEMPLATES } from "./default-templates.ts";
import { emptyKnowledgeState, kstDay, type KnowledgeState, type Command, type Category, type MeetingItem, type Proposal } from "./model.ts";
import type { KnowledgeDocument, DocumentVersion } from "../types";

export class KnowledgeCommandError extends Error { code: string; constructor(message: string, code = "INVALID_COMMAND") { super(message); this.code = code; } }
const denied = () => { throw new KnowledgeCommandError("이 작업을 수행할 권한이 없습니다.", "FORBIDDEN"); };
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
export function accessContext(state: KnowledgeState) { return { categories: new Map(state.categories.map(c => [c.id, c])), meetings: new Map(state.meetings.map(m => [m.id, { visibility: m.metadata.visibility, attendees: m.attendees }])) }; }
export function visibleState(state: KnowledgeState, actor: KnowledgeActor): KnowledgeState {
  const byId=new Map(state.documents.map(doc=>[doc.id,doc])),context=accessContext(state);
  const documents = state.documents.filter(doc => canReadDocumentTree(actor, doc, byId, context));
  const ids = new Set(documents.map(doc => doc.id));
  return { ...state, documents,
    categories: state.categories.filter(c => !c.archived_at && (c.space === "mine" ? c.owner_id === actor.ownerId : actor.memberKind !== "partner" || c.partner_ids.includes(actor.ownerId))),
    drafts: state.drafts.filter(d => d.user_id === actor.ownerId && ids.has(d.document_id)),
    inbox: state.inbox.filter(n => n.owner_id === actor.ownerId && !n.processed_at),
    templates: state.templates.filter(t => !t.archived_at && (t.scope === "company" || t.owner_id === actor.ownerId)),
    pins: state.pins.filter(id => ids.has(id)), versions: Object.fromEntries(Object.entries(state.versions).filter(([id]) => ids.has(id))),
    candidates: state.candidates.filter(c => ids.has(c.document_id)), proposals: state.proposals.filter(p => ids.has(p.document_id)),
    meetings: state.meetings.filter(m => m.attendees.includes(actor.ownerId) || (actor.memberKind !== "partner" && m.metadata.visibility === "team")),
    events: state.events.filter(e => actor.role === "admin" || e.actor_id === actor.ownerId).map(e => e.target_type === "document" && !ids.has(e.target_id) ? { ...e, target_id: "", detail: { title: "볼 수 없는 문서" } } : e),
  };
}
function version(doc: KnowledgeDocument, actor: KnowledgeActor, reason: string): DocumentVersion { return { version_no: doc.current_version, title: doc.title, content_md: doc.content_md, author_id: actor.ownerId, author_name: "데모 사용자", reason, created_at: doc.updated_at }; }
export function createDemoKnowledge(actor: KnowledgeActor): KnowledgeState {
  const state = emptyKnowledgeState();
  state.templates = DEFAULT_TEMPLATES;
  state.people = [{ id: actor.ownerId, display_name: "데모 사용자", role: actor.role, member_kind: actor.memberKind ?? "staff", can_approve: true }, { id: "example-reviewer", display_name: "검토 담당자", role: "admin", member_kind: "staff", can_approve: true }, { id: "example-approver", display_name: "승인 담당자", role: "member", member_kind: "staff", can_approve: true }, { id: "example-partner", display_name: "협업 파트너", role: "member", member_kind: "partner", can_approve: false }];
  state.categories = [{ id: "example-personal", space: "mine", owner_id: actor.ownerId, name: "데일리", color: "purple", sort_order: 0, partner_ids: [] }, { id: "example-team", space: "team", owner_id: null, name: "프로젝트", color: "blue", sort_order: 0, partner_ids: [] }];
  const now = new Date().toISOString();
  const base: KnowledgeDocument = { id: "example-team-document", title: "프로젝트 시작 가이드", content_md: "## 목적\n\n팀이 같은 기준으로 일을 시작합니다.\n\n## 다음 단계\n\n- [ ] 완료 기준 확인\n- [ ] 담당과 일정 합의\n\n[[example-canonical]]", folder: "프로젝트", status: "team", owner_id: actor.ownerId, created_by: actor.ownerId, created_at: now, updated_at: now, source: "wiki", source_ref: null, brand: "", team: "", tags: ["시작"], current_version: 1, category_id: "example-team", work_state: "doing" };
  state.documents = [base, { ...base, id: "example-canonical", title: "문서 작성 기준", status: "canonical", owner_id: "example-reviewer", content_md: "## 작성 원칙\n\n목적과 근거를 명확히 적습니다. 정본 변경은 검토와 승인을 거칩니다.", category_id: null, steward_id: actor.ownerId, retention_hold: true, review_due_on: kstDay(), tags: ["기준"] }];
  for (const doc of state.documents) state.versions[doc.id] = [version(doc, actor, "예시 문서")];
  return state;
}

/** Demo-only transactional reducer. Throws before persistence; no optimistic success. */
export function applyKnowledgeCommand(previous: KnowledgeState, actor: KnowledgeActor, command: Command, now = new Date().toISOString()): { state: KnowledgeState; id?: string } {
  const s = structuredClone(previous), c = command, context = accessContext(s);
  if (actor.type !== "user" || actor.active === false) denied();
  const id = () => crypto.randomUUID();
  const find = () => { const d = s.documents.find(d => d.id === c.id); if (!d || !canReadDocumentTree(actor, d, new Map(s.documents.map(row=>[row.id,row])),context)) denied(); return d!; };
  const checkVersion = (d: KnowledgeDocument) => { if (c.expectedVersion !== d.current_version) throw new KnowledgeCommandError("다른 사람이 먼저 수정했습니다. 입력한 내용을 보존했습니다.", "VERSION_CONFLICT"); };
  const event = (action: string, target: string, detail: Record<string, unknown> = {}, type = "document") => s.events.unshift({ id: id(), actor_id: actor.ownerId, action, target_type: type, target_id: target, detail, created_at: now });
  const commit = (d: KnowledgeDocument, title: string, body: string) => { if (d.title === title && d.content_md === body) return; d.title = title; d.content_md = body; d.current_version++; d.updated_at = now; s.versions[d.id] = [version(d, actor, "문서 저장"), ...(s.versions[d.id] ?? [])]; };
  const create = (space: string, title: string, content: string, category: string | null = null) => {
    if (space !== "mine" && space !== "team") throw new KnowledgeCommandError("문서 공간을 확인해 주세요.");
    if (space === "team" && actor.memberKind === "partner") denied();
    if (category && !s.categories.some(cat => cat.id === category && !cat.archived_at && cat.space === space && (space === "team" || cat.owner_id === actor.ownerId))) throw new KnowledgeCommandError("카테고리와 문서 공간이 다릅니다.");
    const d: KnowledgeDocument = { id: id(), title: title.trim() || "제목 없음", content_md: content, folder: "", status: space === "mine" ? "draft" : "team", owner_id: actor.ownerId, created_by: actor.ownerId, created_at: now, updated_at: now, current_version: 1, tags: [], source: "wiki", source_ref: null, brand: "", team: "", category_id: category, work_state: "todo" };
    s.documents.unshift(d); s.versions[d.id] = [version(d, actor, "새 문서")]; return d;
  };
  let resultId: string | undefined = c.id;
  switch (c.action) {
    case "document.create": {
      if (c.dailyOn) { const existing = s.documents.find(d => d.owner_id === actor.ownerId && d.daily_on === c.dailyOn && d.status !== "archived"); if (existing) return { state: s, id: existing.id }; }
      const d = create(text(c.space, "mine"), text(c.title), text(c.content), text(c.categoryId) || null);
      if(c.parentId){const parent=s.documents.find(row=>row.id===c.parentId);if(!parent||!canEditDocument(actor,parent,context)||parent.status!==d.status)denied();d.parent_document_id=parent!.id;}
      if (c.dailyOn) { if (d.status !== "draft") denied(); d.daily_on = text(c.dailyOn); d.work_state = "doing"; }
      resultId = d.id; break;
    }
    case "document.commit": { const d = find(); if (!canEditDocument(actor, d, context)) denied(); checkVersion(d); commit(d, text(c.title, d.title).trim() || "제목 없음", text(c.content, d.content_md)); s.drafts = s.drafts.filter(draft => !(draft.document_id === d.id && draft.user_id === actor.ownerId && draft.updated_at <= text(c.draftUpdatedAt, now))); break; }
    case "document.draft": { const d = find(); if (!canEditDocument(actor, d, context) && d.status !== "canonical") denied(); s.drafts = [{ document_id: d.id, user_id: actor.ownerId, title: text(c.title), content_md: text(c.content), base_version: Number(c.expectedVersion), updated_at: now }, ...s.drafts.filter(draft => !(draft.document_id === d.id && draft.user_id === actor.ownerId))]; break; }
    case "document.discard": { const d = find(); s.drafts = s.drafts.filter(draft => !(draft.document_id === d.id && draft.user_id === actor.ownerId)); break; }
    case "document.properties": {
      const d = find(); if (!canEditDocument(actor, d, context)) denied(); checkVersion(d);
      if ("categoryId" in c) { if (!canChangeCategory(actor, d, context) && d.status !== "draft") denied(); const cat = s.categories.find(cat => cat.id === c.categoryId); if (c.categoryId && (!cat || cat.space !== (d.status === "draft" ? "mine" : "team") || (cat.space==="mine"&&cat.owner_id!==actor.ownerId) || cat.archived_at)) throw new KnowledgeCommandError("카테고리와 문서 공간이 다릅니다."); d.category_id = text(c.categoryId) || null; }
      if (c.workState && ["todo", "doing", "done"].includes(text(c.workState))) d.work_state = c.workState as KnowledgeDocument["work_state"];
      if ("dueOn" in c) d.due_on = text(c.dueOn) || null;
      if ("tags" in c) { if (actor.memberKind === "partner" && d.status !== "draft") denied(); d.tags = strings(c.tags); }
      d.updated_at = now; break;
    }
    case "document.duplicate": { const d = find(); resultId = create("mine", `${d.title} 사본`, d.content_md).id; break; }
    case "document.export": {const d=find();if(!["md","pdf"].includes(text(c.format))||!["doc","doc_versions"].includes(text(c.range)))throw new KnowledgeCommandError("내보내기 범위를 확인해 주세요.");event("export",d.id,{format:c.format,range:c.range,version:d.current_version});break;}
    case "document.share": {
      const d = find(); if (d.owner_id !== actor.ownerId || actor.memberKind === "partner" || s.candidates.some(row => row.document_id === d.id && row.status === "open") || d.status === "canonical") denied(); checkVersion(d);
      if (c.copy) resultId = create("team", d.title, d.content_md, text(c.categoryId) || null).id;
      else { d.status = c.space === "mine" ? "draft" : "team"; d.category_id = text(c.categoryId) || null; d.daily_on = null; d.work_state = "todo"; event("document_share", d.id); }
      break;
    }
    case "document.archive": { const d = find(); if(d.meeting_record_id||s.candidates.some(c=>c.document_id===d.id&&c.status==="open")) throw new KnowledgeCommandError("회의 또는 검토 중 문서는 해당 업무 화면에서 처리해 주세요."); if (d.owner_id !== actor.ownerId && actor.role !== "admin") denied(); if ((d.status === "canonical" || d.retention_hold) && (actor.role !== "admin" || !text(c.reason).trim())) denied(); d.archived_from_status = d.status; d.status = "archived"; d.archived_at = now; d.archived_by = actor.ownerId; d.retention_hold ||= d.archived_from_status === "canonical"; event("document_trash", d.id, { reason: c.reason }); break; }
    case "trash.restore": { const d = find(); if (d.status !== "archived") denied(); if (d.archived_from_status === "canonical") { checkVersion(d); if (actor.role !== "admin" || !text(c.reason).trim()) denied(); const approver=s.people.find(p=>p.id===c.approverId&&p.can_approve&&p.member_kind==="staff"&&![actor.ownerId,d.owner_id].includes(p.id)); if (!approver || !c.reviewDueOn) throw new KnowledgeCommandError("작성자와 다른 승인자·검토일을 선택해 주세요."); d.status="review"; d.archived_at=null; d.archived_by=null; resultId=id(); s.candidates.unshift({id:resultId,document_id:d.id,requested_approver_id:approver.id,target_folder:text(c.folder),steward_id:text(c.stewardId)||null,review_due_on:text(c.reviewDueOn),submitted_by:actor.ownerId,submitted_at:now,status:"open"}); event("canonical_restore_request",d.id,{reason:c.reason}); break; } d.status = !d.archived_from_status || d.archived_from_status === "draft" ? "draft" : "team"; d.archived_at = null; d.archived_by = null; if (s.categories.some(cat => cat.id === d.category_id && cat.archived_at)) d.category_id = null; if (s.documents.some(other => other.id !== d.id && other.owner_id === d.owner_id && other.daily_on === d.daily_on && other.status !== "archived")) d.daily_on = null; event("document_restore", d.id); break; }
    case "trash.purge": { const d = find(); if (actor.role !== "admin" || d.status !== "archived" || d.retention_hold || d.archived_from_status === "canonical") denied(); if (!text(c.reason).trim() || c.confirm !== true) throw new KnowledgeCommandError("사유와 두 번째 확인이 필요합니다."); s.documents = s.documents.filter(row => row.id !== d.id); delete s.versions[d.id]; s.drafts = s.drafts.filter(row => row.document_id !== d.id); s.pins = s.pins.filter(value => value !== d.id); event("document_purge", d.id, { reason: c.reason }); break; }
    case "pin.toggle": { const d = find(); s.pins = s.pins.includes(d.id) ? s.pins.filter(value => value !== d.id) : [...s.pins, d.id]; break; }
    case "category.batch": {
      const rows = Array.isArray(c.categories) ? c.categories as Category[] : [];
      const deleted = strings(c.deleted);
      const space = text(c.space);
      const names = rows.map(row => row.name.trim().toLowerCase());
      if (names.some(name => !name || name.length > 20) || new Set(names).size !== names.length) throw new KnowledgeCommandError("카테고리 이름은 중복 없이 1~20자로 적어 주세요.");
      for (const row of rows) {
        const old = s.categories.find(cat => cat.id === row.id && cat.space === space);
        if (!old || !canManageCategory(actor, old) || (JSON.stringify(old.partner_ids) !== JSON.stringify(row.partner_ids) && !canManageCategory(actor, old, true))) denied();
      }
      for (const value of deleted) { const old = s.categories.find(cat => cat.id === value && cat.space === space); if (!old || !canManageCategory(actor, old, true)) denied(); }
      rows.forEach((row,index) => { const old = s.categories.find(cat => cat.id === row.id)!; Object.assign(old,{name:row.name.trim(),color:row.color,sort_order:index,partner_ids:row.partner_ids}); });
      for (const value of deleted) { s.categories.find(cat => cat.id === value)!.archived_at=now; s.documents.forEach(doc=>{if(doc.category_id===value)doc.category_id=null;}); }
      break;
    }
    case "category.save": {
      let cat = s.categories.find(row => row.id === c.id);
      const space = text(c.space, cat?.space ?? "mine") as Category["space"];
      if (!canManageCategory(actor, cat ?? { space, owner_id: actor.ownerId }) || (("partnerIds" in c || c.archived) && !canManageCategory(actor, cat ?? { space, owner_id: actor.ownerId }, true))) denied();
      const name = text(c.name, cat?.name).trim(); if (!name || name.length > 20 || s.categories.some(other => !other.archived_at && other.id !== cat?.id && other.space === space && other.owner_id === (space === "mine" ? actor.ownerId : null) && other.name.toLowerCase() === name.toLowerCase())) throw new KnowledgeCommandError("카테고리 이름은 중복 없이 1~20자로 적어 주세요.");
      if (!cat) { cat = { id: id(), space, owner_id: space === "mine" ? actor.ownerId : null, name, color: "blue", sort_order: s.categories.length, partner_ids: [] }; s.categories.push(cat); }
      cat.name = name; cat.color = text(c.color, cat.color); if (Array.isArray(c.partnerIds)) cat.partner_ids = strings(c.partnerIds); if (typeof c.sortOrder === "number") cat.sort_order = c.sortOrder;
      if (cat.space === "team") event("category_update", cat.id, {}, "category"); resultId = cat.id; break;
    }
    case "category.archive": { const cat = s.categories.find(row => row.id === c.id); if (!cat || !canManageCategory(actor, cat, true)) denied(); cat!.archived_at = now; s.documents.forEach(d => { if (d.category_id === c.id) d.category_id = null; }); break; }
    case "link.ignore": {const d=find();if(!canEditDocument(actor,d,context)&&d.status!=="canonical")denied();const target=text(c.target).trim();if(!target||target.length>300)throw new KnowledgeCommandError("연결 대상을 확인해 주세요.");event("link_ignore",d.id,{sourceId:d.id,target,sourceVersion:d.current_version},"link");break;}
    case "note.capture": {
      const body=text(c.body).trim(); if (!body || body.length>500) throw new KnowledgeCommandError("메모는 1~500자로 적어 주세요.");
      if (text(c.target).startsWith("meeting:")) { const m=s.meetings.find(m=>m.id===c.meetingId&&m.status==="active"&&m.attendees.includes(actor.ownerId)); if(!m) denied(); return applyKnowledgeCommand(s,actor,{action:"meeting.save",id:m!.id,expectedVersion:m!.version,content:m!.description+"\n\n"+body},now); }
      const note=applyKnowledgeCommand(s,actor,{action:"inbox.create",body},now);
      return c.target==="today"?applyKnowledgeCommand(note.state,actor,{action:"inbox.process",id:note.id,today:true},now):note;
    }
    case "inbox.create": { const body = text(c.body).trim(); if (!body || body.length > 500) throw new KnowledgeCommandError("메모는 1~500자로 적어 주세요."); resultId = id(); s.inbox.unshift({ id: resultId, owner_id: actor.ownerId, body, created_at: now }); break; }
    case "inbox.delete": { s.inbox = s.inbox.filter(row => !(row.id === c.id && row.owner_id === actor.ownerId)); break; }
    case "inbox.process": {
      const note = s.inbox.find(row => row.id === c.id && row.owner_id === actor.ownerId && !row.processed_at); if (!note) denied();
      let d = c.today ? s.documents.find(row => row.daily_on === kstDay(new Date(now)) && row.owner_id === actor.ownerId && row.status === "draft") : undefined;
      if (d && s.drafts.some(draft => draft.document_id === d?.id)) throw new KnowledgeCommandError("작성 중인 초안을 저장한 뒤 다시 처리해 주세요.", "DRAFT_CONFLICT");
      if (d) commit(d, d.title, `${d.content_md}\n\n${note!.body}`); else { d = create("mine", c.today ? kstDay(new Date(now)) : note!.body.slice(0, 30), note!.body, text(c.categoryId) || null); if (c.today) d.daily_on = kstDay(new Date(now)); }
      note!.processed_at = now; note!.processed_document_id = d.id; resultId = d.id; break;
    }
    case "template.save": { const previous = s.templates.find(row => row.id === c.id || Boolean(c.defaultKey&&row.default_key===c.defaultKey)); if(c.defaultKey&&(actor.role!=="admin"||!s.templates.some(t=>t.id===c.defaultKey||t.default_key===c.defaultKey))) denied(); if (previous && (previous.scope === "company" ? actor.role !== "admin" : previous.owner_id !== actor.ownerId)) denied(); if (c.scope === "company" && actor.role !== "admin") denied(); const name = text(c.name).trim(); if (!name || name.length > 40) throw new KnowledgeCommandError("이름은 1~40자로 적어 주세요."); resultId = previous?.id ?? id(); s.templates = [{ id: resultId, default_key:text(c.defaultKey)||previous?.default_key, archived_at:c.archived===true?now:undefined, name, description: text(c.description), body_md: text(c.content), default_space: c.defaultSpace === "team" ? "team" : c.defaultSpace === "meeting" ? "meeting" : "mine", kind: c.kind === "meeting" ? "meeting" : c.kind === "candidate" ? "candidate" : "doc", scope: previous?.scope ?? (c.scope === "company" ? "company" : "personal"), owner_id: (previous?.scope ?? c.scope) === "company" ? null : actor.ownerId, sort_order: previous?.sort_order ?? s.templates.length }, ...s.templates.filter(row => row.id !== resultId&&row.id!==c.defaultKey)]; break; }
    case "template.archive": { const t = s.templates.find(row => row.id === c.id); if (!t || (t.scope === "company" ? actor.role !== "admin" : t.owner_id !== actor.ownerId)) denied(); t!.archived_at = now; break; }
    case "candidate.submit": { const d = find(); checkVersion(d); if (actor.memberKind === "partner" || (d.owner_id !== actor.ownerId && actor.role !== "admin") || d.status !== "team") denied(); const approver = s.people.find(p => p.id === c.approverId && p.can_approve && p.member_kind !== "partner" && ![actor.ownerId, d.owner_id].includes(p.id)); if (!approver || !c.reviewDueOn) throw new KnowledgeCommandError("작성자와 다른 승인자·검토일을 선택해 주세요."); if (s.candidates.some(row => row.document_id === d.id && row.status === "open")) throw new KnowledgeCommandError("이미 검토 중인 후보입니다."); d.status = "review"; d.archived_at = null; resultId = id(); s.candidates.unshift({ id: resultId, document_id: d.id, requested_approver_id: approver.id, target_folder: text(c.folder), steward_id: text(c.stewardId) || null, review_due_on: text(c.reviewDueOn), submitted_by: actor.ownerId, submitted_at: now, status: "open" }); break; }
    case "candidate.decide": { const row = s.candidates.find(row => row.id === c.id && row.status === "open"); const d = s.documents.find(d => d.id === row?.document_id); if (!row || !d || !canDecideProposal(actor, { author_id: row.submitted_by, requested_approver_id: row.requested_approver_id }, d, text(c.reason))) denied(); checkVersion(d!); if (c.decision === "returned" && !text(c.reason).trim()) throw new KnowledgeCommandError("보완 이유를 적어 주세요."); row!.status = c.decision === "approved" ? "approved" : "returned"; row!.decision_note = text(c.reason); d!.status = row!.status === "approved" ? "canonical" : "team"; if (d!.status === "canonical") { d!.folder = row!.target_folder; d!.steward_id = row!.steward_id; d!.review_due_on = row!.review_due_on; d!.retention_hold = true; d!.category_id = null; } event("candidate_decide", d!.id); break; }
    case "candidate.withdraw": { const row = s.candidates.find(row => row.id === c.id && row.status === "open" && row.submitted_by === actor.ownerId); if (!row) denied(); row!.status = "withdrawn"; const d = s.documents.find(d => d.id === row!.document_id); if (d) d.status = "team"; break; }
    case "canon.steward": { const d=find(); checkVersion(d); if (actor.role!=="admin" || d.status!=="canonical") denied(); const steward=s.people.find(p=>p.id===c.stewardId); if(!steward) throw new KnowledgeCommandError("활성 담당자를 선택해 주세요."); d.steward_id=steward.id; event("canon_steward",d.id); break; }
    case "canon.keep": { const d = find(); checkVersion(d); if (d.status !== "canonical" || (d.steward_id !== actor.ownerId && actor.role !== "admin")) denied(); d.review_due_on = kstDay(new Date(Date.parse(now) + 90 * 86400000)); event("canon_review_keep", d.id); break; }
    case "canon.demote": { const d = find(); checkVersion(d); if (d.status !== "canonical" || actor.memberKind === "partner" || (d.steward_id !== actor.ownerId && actor.role !== "admin") || !text(c.reason).trim()) denied(); d.status = "team"; event("canon_demote", d.id, { reason: c.reason }); break; }
    case "proposal.comment": { const p=s.proposals.find(row=>row.id===c.id&&row.status==="open"); const d=s.documents.find(row=>row.id===p?.document_id); if(!p||!d||!canReadDocument(actor,d,context))denied(); const line=Number(c.lineNo),body=text(c.body).trim();if(!Number.isInteger(line)||line<1||line>p!.content_md.split("\n").length||!body||body.length>2000)throw new KnowledgeCommandError("댓글 내용과 줄을 확인해 주세요.");p!.comments=[...(p!.comments??[]),{id:id(),line_no:line,body,created_at:now}];break; }
    case "proposal.create": {
      const d = find(); if (d.status !== "canonical") denied(); if (!text(c.reason).trim()) throw new KnowledgeCommandError("변경 이유를 적어 주세요.");
      const approver = s.people.find(p => p.id === c.approverId && p.can_approve && p.member_kind === "staff" && ![actor.ownerId, d.owner_id].includes(p.id)); if (!approver) throw new KnowledgeCommandError("작성자와 다른 승인자를 선택해 주세요.");
      const existing = s.proposals.find(p => p.id === c.proposalId && p.author_id === actor.ownerId && p.status === "returned" && p.return_kind === "revise"); resultId = existing?.id ?? id();
      const p: Proposal = { id: resultId, document_id: d.id, base_version: Number(c.expectedVersion), title: text(c.title, d.title), content_md: text(c.content, d.content_md), folder: text(c.folder, d.folder), brand: d.brand, team: d.team, tags: Array.isArray(c.tags) ? strings(c.tags) : d.tags, author_id: actor.ownerId, agent_key_id: null, status: "open", created_at: existing?.created_at ?? now, updated_at: now, author_note: text(c.reason), requested_approver_id: approver.id, review_due_on: text(c.reviewDueOn, d.review_due_on ?? "") || null, ai_assist: text(c.aiAssist) };
      s.proposals = [p, ...s.proposals.filter(row => row.id !== resultId)]; event("proposal_create", resultId, {}, "proposal"); break;
    }
    case "proposal.decide": { const p = s.proposals.find(p => p.id === c.id && p.status === "open"); const d = s.documents.find(d => d.id === p?.document_id); if (!p || !d) denied(); if (c.decision === "withdrawn") { if (p!.author_id !== actor.ownerId) denied(); p!.status = "withdrawn"; break; } if (!canDecideProposal(actor, p!, d!, text(c.reason))) denied(); if (c.decision === "approved") { if (p!.base_version !== d!.current_version) throw new KnowledgeCommandError("정본이 바뀌었습니다. 충돌 해결 후 승인해 주세요.", "VERSION_CONFLICT"); const before = d!.current_version; commit(d!, p!.title, p!.content_md); if (before === d!.current_version) { d!.current_version++; d!.updated_at = now; s.versions[d!.id] = [version(d!, actor, "변경 제안 승인"), ...(s.versions[d!.id] ?? [])]; } d!.folder = p!.folder; d!.tags = p!.tags; d!.review_due_on = p!.review_due_on; p!.status = "approved"; } else { if (!text(c.reason).trim()) throw new KnowledgeCommandError("보완·반려 이유를 적어 주세요."); p!.status = "returned"; p!.return_kind = c.decision === "rejected" ? "reject" : "revise"; } p!.reviewer_id = actor.ownerId; p!.note = text(c.reason); p!.decided_at = now; event("proposal_decide", p!.id, {}, "proposal"); break; }
    case "proposal.rebase": { const p = s.proposals.find(p => p.id === c.id && p.status === "open"); const d = s.documents.find(d => d.id === p?.document_id); if (!p || !d || (p.author_id !== actor.ownerId && !canDecideProposal(actor, p, d, text(c.reason)))) denied(); checkVersion(d!); p!.title = text(c.title, p!.title); p!.content_md = text(c.content, p!.content_md); p!.folder = text(c.folder, p!.folder); p!.tags = strings(c.tags); p!.review_due_on = text(c.reviewDueOn) || null; p!.base_version = d!.current_version; p!.updated_at = now; break; }
    case "meeting.create": { const previous=c.previousMeetingId?s.meetings.find(m=>m.id===c.previousMeetingId&&m.status==="done"&&(m.attendees.includes(actor.ownerId)||(actor.memberKind!=="partner"&&m.metadata.visibility==="team"))):null;if(c.previousMeetingId&&!previous)denied(); resultId = id(); const visibility = actor.memberKind === "partner" || c.visibility === "attendees" || c.templateName === "1:1" ? "attendees" : "team"; s.meetings.unshift({ id: resultId, title: text(c.title).trim() || `${text(c.templateName, "기타")} — ${kstDay(new Date(now))}`, description: "", status: "planned", version: 1, owner_id: actor.ownerId, created_by: actor.ownerId, starts_at: text(c.startsAt) || null, attendees: [...new Set([actor.ownerId,...(previous?.attendees??[])])], metadata: { workspace: "knowledge", visibility:actor.memberKind==="partner"?"attendees":previous?.metadata.visibility??visibility, agenda: previous?.metadata.agenda??text(c.content), previousMeetingId:previous?.id, items: (previous?.metadata.items??[]).filter(i=>i.kind==="task"&&i.state==="accepted").map(i=>({...i,id:id(),state:"pending"})) }, updated_at: now }); break; }
    case "meeting.save": case "meeting.start": case "meeting.finish": case "meeting.review": case "meeting.correct": {
      const m = s.meetings.find(row => row.id === c.id); if (!m || (!m.attendees.includes(actor.ownerId) && actor.role !== "admin")) denied(); if (m!.version !== c.expectedVersion) throw new KnowledgeCommandError("회의가 변경됐습니다. 다시 불러와 주세요.", "VERSION_CONFLICT");
      if (c.action === "meeting.correct") { if (m!.status !== "done" || (m!.owner_id !== actor.ownerId && actor.role !== "admin") || !text(c.reason).trim() || !text(c.content).trim()) denied(); m!.metadata.corrections = [...(m!.metadata.corrections ?? []), { text: text(c.content), reason: text(c.reason), at: now, by: actor.ownerId }]; }
      else { if (m!.status === "done" || (m!.status === "review" && m!.owner_id !== actor.ownerId && actor.role !== "admin")) denied();
        if (c.action === "meeting.start") { if (m!.status !== "planned") denied(); m!.status = "active"; m!.starts_at = now; }
        if (c.action === "meeting.finish") { if (m!.status !== "active") denied(); m!.status = "review"; }
        if (c.action === "meeting.review") { if (m!.status !== "review" || (m!.owner_id !== actor.ownerId && actor.role !== "admin") || m!.metadata.items.some(i => i.state === "pending")) denied(); m!.status = "done"; m!.metadata.reviewedAt = now; m!.metadata.reviewedBy = actor.ownerId; }
        if (c.action === "meeting.save") { m!.title = text(c.title, m!.title); m!.description = text(c.content, m!.description); if ("startsAt" in c) m!.starts_at = text(c.startsAt) || null; if ("summary" in c) m!.metadata.summary = text(c.summary); if ("agenda" in c) m!.metadata.agenda = text(c.agenda); if (Array.isArray(c.items)) m!.metadata.items = c.items as MeetingItem[]; if ("attendees" in c || "visibility" in c) { if (m!.owner_id !== actor.ownerId && actor.role !== "admin") denied(); if (Array.isArray(c.attendees)&&strings(c.attendees).some(id=>!s.people.some(p=>p.id===id))) throw new KnowledgeCommandError("참석자를 확인해 주세요."); if (Array.isArray(c.attendees)) m!.attendees = [...new Set([m!.owner_id, ...strings(c.attendees)])]; if (c.visibility === "team" && actor.memberKind === "partner") denied(); if (c.visibility === "team" || c.visibility === "attendees") m!.metadata.visibility = c.visibility; } }
      } m!.version++; m!.updated_at = now; event(c.action, m!.id, {}, "meeting"); break;
    }
    default: throw new KnowledgeCommandError("지원하지 않는 작업입니다.");
  }
  return { state: s, id: resultId };
}

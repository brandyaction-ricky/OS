"use client";

import { ArrowRight, Bot, CheckCircle2, CircleAlert, Clock3, Code2, FolderGit2, Plus, Target, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRecord, listRecords, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

const JOB_FLOW = ["backlog", "active", "review", "done"];
const STATUS_LABEL: Record<string, string> = { planned: "계획", active: "진행 중", blocked: "막힘", review: "검수", done: "완료", backlog: "요청 대기" };

function meta(record: OsRecord, key: string) {
  const value = record.metadata?.[key];
  return typeof value === "string" ? value : "";
}

export function ProjectHubWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [modal, setModal] = useState<"project" | "job" | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    try {
      const [projects, tasks, jobs] = await Promise.all([
        listRecords(accessToken, "project", "limit=200"),
        listRecords(accessToken, "task", "limit=200"),
        listRecords(accessToken, "ai_job", "limit=200"),
      ]);
      const next = [...projects.records, ...tasks.records, ...jobs.records];
      setRecords(next);
      setSelectedId((current) => current || projects.records[0]?.id || "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "프로젝트를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);

  const projects = records.filter((record) => record.record_type === "project");
  const tasks = records.filter((record) => record.record_type === "task");
  const jobs = records.filter((record) => record.record_type === "ai_job");
  const selected = projects.find((record) => record.id === selectedId) ?? projects[0] ?? null;
  const projectTasks = tasks.filter((record) => record.parent_id === selected?.id);
  const projectJobs = jobs.filter((record) => record.parent_id === selected?.id);
  const stats = useMemo(() => ({
    active: projects.filter((record) => ["planned", "active", "blocked"].includes(record.status)).length,
    running: jobs.filter((record) => record.status === "active").length,
    review: jobs.filter((record) => record.status === "review").length,
    blocked: [...projects, ...tasks, ...jobs].filter((record) => record.status === "blocked").length,
  }), [jobs, projects, tasks]);

  const submitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setSaving(true); setError("");
    try {
      const { record } = await createRecord(accessToken, {
        recordType: "project", title: value("title"), description: value("objective"), status: "active",
        priority: value("priority"), brand: value("brand"), team: value("team"), dueDate: value("dueDate") || null,
        metadata: { repository: value("repository"), environment: value("environment"), successMetric: value("successMetric") },
      });
      setModal(null); await load(); setSelectedId(record.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "프로젝트를 만들지 못했습니다."); }
    finally { setSaving(false); }
  };

  const submitJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setSaving(true); setError("");
    try {
      await createRecord(accessToken, {
        recordType: "ai_job", parentId: selected.id, title: value("title"), description: value("request"),
        status: "backlog", priority: value("priority"), brand: selected.brand, team: selected.team || profile?.team || "",
        dueDate: value("dueDate") || null, sourceUrl: value("resultUrl") || null,
        metadata: { aiTool: value("aiTool"), repository: value("repository") || meta(selected, "repository"), completionCriteria: value("completionCriteria"), risk: value("risk") },
      });
      setModal(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI 작업을 요청하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const advanceJob = async (job: OsRecord) => {
    const current = JOB_FLOW.indexOf(job.status);
    const status = JOB_FLOW[Math.min(current + 1, JOB_FLOW.length - 1)];
    if (!status || status === job.status) return;
    try { await updateRecord(accessToken, { id: job.id, expectedVersion: job.version, status }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
  };

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">AI PROJECT HUB</span><h1>프로젝트 관제</h1><p>각 프로젝트의 목표, 실행 업무, AI 요청과 검수 상태를 한 화면에서 관리합니다.</p></div><div className="header-actions"><button className="secondary-button" disabled={!selected} onClick={() => setModal("job")}><Bot size={16} /> AI 요청서</button><button className="primary-button" onClick={() => setModal("project")}><Plus size={16} /> 프로젝트 추가</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <section className="metric-grid compact-metrics">
      <div className="metric-card"><div className="metric-top"><span>진행 프로젝트</span><span className="metric-icon"><FolderGit2 size={16} /></span></div><div className="metric-value">{stats.active}</div><div className="metric-caption">현재 관리 중</div></div>
      <div className="metric-card"><div className="metric-top"><span>AI 실행 중</span><span className="metric-icon"><Code2 size={16} /></span></div><div className="metric-value">{stats.running}</div><div className="metric-caption">GPT·Codex·Claude</div></div>
      <div className="metric-card"><div className="metric-top"><span>검수 대기</span><span className="metric-icon"><CheckCircle2 size={16} /></span></div><div className="metric-value">{stats.review}</div><div className="metric-caption warn">대표 판단 필요</div></div>
      <div className="metric-card"><div className="metric-top"><span>막힌 항목</span><span className="metric-icon"><CircleAlert size={16} /></span></div><div className="metric-value">{stats.blocked}</div><div className={`metric-caption ${stats.blocked ? "warn" : "good"}`}>{stats.blocked ? "원인 확인 필요" : "병목 없음"}</div></div>
    </section>
    <section className="project-hub-layout">
      <aside className="panel project-index"><div className="panel-header"><div><h2>프로젝트</h2><p>{projects.length}개 운영 중</p></div></div>{loading ? <div className="loading-state">불러오는 중…</div> : projects.map((project) => <button className={selected?.id === project.id ? "active" : ""} key={project.id} onClick={() => setSelectedId(project.id)}><span className={`priority-mark priority-${project.priority}`} /><span><strong>{project.title}</strong><small>{project.brand || "공통"} · {STATUS_LABEL[project.status] ?? project.status}</small></span><ArrowRight size={14} /></button>)}{!loading && !projects.length ? <div className="list-empty"><Target size={20} /><span>첫 프로젝트를 추가하세요.</span></div> : null}</aside>
      <div className="project-detail">
        {selected ? <>
          <article className="panel project-summary"><header><div><span className={`status-pill status-${selected.status}`}>{STATUS_LABEL[selected.status] ?? selected.status}</span><h2>{selected.title}</h2><p>{selected.description || "프로젝트 목적을 입력하세요."}</p></div><div><span>{meta(selected, "repository") || "저장소 미지정"}</span><small>{meta(selected, "successMetric") || "성공 지표 미지정"}</small></div></header><div className="project-facts"><span><strong>{projectTasks.filter((item) => item.status !== "done").length}</strong> 진행 업무</span><span><strong>{projectJobs.filter((item) => !["done"].includes(item.status)).length}</strong> AI 작업</span><span><strong>{selected.due_date || "미정"}</strong> 목표 기한</span></div></article>
          <div className="project-columns">
            <article className="panel"><div className="panel-header"><div><h2>실행 업무</h2><p>담당자·기한 기반</p></div><span className="count-badge">{projectTasks.length}</span></div><div className="project-item-list">{projectTasks.map((task) => <div key={task.id}><span className={`mini-status status-${task.status}`} /><span><strong>{task.title}</strong><small>{STATUS_LABEL[task.status] ?? task.status} · {task.due_date || "기한 없음"}</small></span><em>{task.progress}%</em></div>)}{!projectTasks.length ? <div className="quiet-state"><Clock3 size={20} /><strong>연결된 업무 없음</strong><span>업무 메뉴에서 프로젝트를 연결할 수 있습니다.</span></div> : null}</div></article>
            <article className="panel"><div className="panel-header"><div><h2>AI 작업 요청</h2><p>요청→실행→검수→완료</p></div><button className="text-button" onClick={() => setModal("job")}><Plus size={13} /> 추가</button></div><div className="ai-job-list">{projectJobs.map((job) => <div key={job.id}><div><span>{meta(job, "aiTool") || "AI"}</span><strong>{job.title}</strong><small>{meta(job, "completionCriteria") || job.description}</small></div><button className={`status-pill status-${job.status}`} onClick={() => advanceJob(job)}>{STATUS_LABEL[job.status] ?? job.status}<ArrowRight size={12} /></button></div>)}{!projectJobs.length ? <div className="quiet-state"><Bot size={20} /><strong>AI 작업 없음</strong><span>완료 조건이 있는 요청서를 만드세요.</span></div> : null}</div></article>
          </div>
        </> : <div className="panel empty-state"><div><span><FolderGit2 /></span><h3>프로젝트를 선택하세요.</h3><p>프로젝트별 업무와 AI 실행 상태가 여기에 표시됩니다.</p></div></div>}
      </div>
    </section>
    {modal ? <div className="drawer-backdrop" onMouseDown={() => !saving && setModal(null)}><form className="record-drawer" onSubmit={modal === "project" ? submitProject : submitJob} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">{modal === "project" ? "NEW PROJECT" : "AI REQUEST"}</span><h2>{modal === "project" ? "새 프로젝트" : `${selected?.title ?? "프로젝트"} AI 요청`}</h2></div><button type="button" className="icon-button" onClick={() => setModal(null)}><X size={18} /></button></div>
      {modal === "project" ? <><label><span>프로젝트명</span><input name="title" required placeholder="예: 회사 OS 개발" /></label><label><span>목적·완료 정의</span><textarea name="objective" required rows={5} placeholder="이 프로젝트가 끝났다고 판단할 기준" /></label><div className="form-grid"><label><span>브랜드</span><input name="brand" placeholder="브랜디액션" /></label><label><span>담당 팀</span><input name="team" defaultValue={profile?.team ?? ""} /></label></div><label><span>GitHub 저장소</span><input name="repository" placeholder="brandyaction-ricky/OS" /></label><div className="form-grid"><label><span>환경</span><select name="environment" defaultValue="DEV"><option>DEV</option><option>Production</option><option>내부 운영</option></select></label><label><span>우선순위</span><select name="priority" defaultValue="high"><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></label></div><label><span>핵심 성공 지표</span><input name="successMetric" placeholder="예: 전 직원 주간 활성 80%" /></label><label><span>목표 기한</span><input type="date" name="dueDate" /></label></> : <><label><span>작업 제목</span><input name="title" required placeholder="무엇을 만들거나 수정할지" /></label><label><span>AI 도구</span><select name="aiTool" defaultValue="Codex"><option>Codex</option><option>GPT</option><option>Claude</option><option>기타</option></select></label><label><span>요청문</span><textarea name="request" required rows={7} placeholder="맥락, 요청사항, 변경하지 말아야 할 범위" /></label><label><span>완료 조건·검수 기준</span><textarea name="completionCriteria" required rows={4} placeholder="검수자가 확인할 구체적인 기준" /></label><div className="form-grid"><label><span>저장소</span><input name="repository" defaultValue={selected ? meta(selected, "repository") : ""} /></label><label><span>기한</span><input type="date" name="dueDate" /></label></div><label><span>위험·주의사항</span><input name="risk" placeholder="예: 운영 DB 데이터 삭제 금지" /></label><label><span>결과 링크</span><input type="url" name="resultUrl" placeholder="https://" /></label><label><span>우선순위</span><select name="priority" defaultValue="high"><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></label></>}
      <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>취소</button><button className="primary-button" disabled={saving}>{saving ? "저장 중…" : modal === "project" ? "프로젝트 생성" : "요청서 등록"}</button></div></form></div> : null}
  </>;
}

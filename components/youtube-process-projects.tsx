"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Film, FolderOpen, Plus, Search, Sparkles, X } from "lucide-react";
import { projectHref, projectName, recentProjects, searchProjects, stageLabel, YP_KIND_SHORT, type YpKind, type YpProject } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { errorMessage, isConflict, youtubeProcessClient, type YpLegacyTopic, type YpMember } from "./youtube-process-data";

const shortDate = (iso: string) => { const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()}`; };

/** S1 프로젝트 (지시서 4-2): new project, the six most recently edited, search, kind filter, PD. */
export function YoutubeProjectsScreen() {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [projects, setProjects] = useState<YpProject[] | null>(null);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | YpKind>("all");
  const [openQuery, setOpenQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  // Videos started on the earlier screens sit in the same list and move over with one click (owner request 2026-10-21).
  const [legacy, setLegacy] = useState<YpLegacyTopic[]>([]);
  const [moving, setMoving] = useState<YpLegacyTopic | null>(null);
  const [busy, setBusy] = useState(false);
  const moveDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setError("");
    Promise.all([client.list(), client.members().catch(() => []), client.legacy().catch(() => [] as YpLegacyTopic[])])
      .then(([list, people, old]) => { if (active) { setProjects(list); setMembers(people); setLegacy(old); } })
      .catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [client, attempt]);

  const all = projects ?? [];
  const shown = (query.trim() ? searchProjects(all, query) : recentProjects(all)).filter(project => kind === "all" || project.yp.topic.type === kind);
  const memberName = (id: string | null) => members.find(member => member.id === id)?.name ?? "—";

  const legacyShown = kind === "live" ? [] : legacy.filter(topic => !query.trim() || topic.title.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR")));
  async function adopt() {
    if (!client || !moving) return;
    setBusy(true); setError("");
    try { const project = await client.adopt(moving.id); moveDialog.current?.close(); router.push(projectHref(project)); }
    catch (reason) { setError(errorMessage(reason)); moveDialog.current?.close(); } finally { setBusy(false); }
  }

  async function changePd(project: YpProject, assigneeId: string) {
    if (!client) return;
    try {
      const saved = await client.update(project.id, project.version, { assigneeId: assigneeId || null });
      setProjects(list => list?.map(row => row.id === saved.id ? saved : row) ?? null);
    } catch (reason) {
      setError(isConflict(reason) ? "다른 사람이 먼저 고쳤어요. 목록을 새로 불러왔어요." : errorMessage(reason));
      setAttempt(value => value + 1);
    }
  }

  return <>
    <div className="yp-ptop">
      <Link className="yp-btn yp-pri yp-lg" href="/content/plan?project=new&view=topic"><Plus size={16} className="yp-i" aria-hidden="true" />새 프로젝트</Link>
      <button type="button" className="yp-btn yp-lg" onClick={() => { setOpenQuery(""); dialog.current?.showModal(); }}><FolderOpen size={16} className="yp-i" aria-hidden="true" />프로젝트 열기</button>
      <span className="yp-sp" />
      <div className="yp-psearch"><Search size={15} className="yp-i" aria-hidden="true" /><input className="yp-in" id="yp-project-search" placeholder="프로젝트 이름으로 찾기" aria-label="프로젝트 검색" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="yp-pfil" role="group" aria-label="유형 필터">
        {(["all", "live", "anim"] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "all" ? "전체" : YP_KIND_SHORT[value]}</button>)}
      </div>
    </div>
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error} <button type="button" className="yp-lnk" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div></div> : null}
    <div className="yp-plist"><table>
      <thead><tr><th>{query.trim() ? `“${query.trim()}” 검색 결과 ${shown.length}개` : "최근 프로젝트"}</th><th>유형</th><th>최근 수정 ↓</th><th>담당자 (PD)</th></tr></thead>
      <tbody>
        {projects === null && !error ? <tr><td colSpan={4} className="yp-pempty" role="status">프로젝트를 불러오는 중이에요…</td></tr>
          : shown.length ? shown.map(project => <tr key={project.id}>
            <td className="yp-c-name"><div className="yp-pname">
              <span className={`yp-pico${project.yp.topic.type === "anim" ? " yp-anim" : ""}`} aria-hidden="true">{project.yp.topic.type === "anim" ? <Sparkles size={18} /> : <Film size={18} />}</span>
              <div style={{ minWidth: 0 }}><Link href={projectHref(project)}><b>{projectName(project)}</b></Link>
                <div className="yp-psub"><span className="yp-tag">{stageLabel(project)}</span>{Object.values(project.yp.gates).some(gate => gate.state === "wait") ? <span className="yp-tag yp-acc">컨펌 대기</span> : null}{Object.values(project.yp.gates).some(gate => gate.state === "changes") ? <span className="yp-tag yp-warn">수정 요청</span> : null}{Object.values(project.yp.gates).some(gate => gate.state === "hold") ? <span className="yp-tag yp-bad">보류</span> : null}</div></div>
            </div></td>
            <td className="yp-c-kind">{project.yp.topic.type ? YP_KIND_SHORT[project.yp.topic.type] : "—"}</td>
            <td>{shortDate(project.yp.contentUpdatedAt)}</td>
            <td>{members.length
              ? <select className="yp-pdsel" aria-label={`${projectName(project)} 담당 PD`} value={project.assigneeId ?? ""} onChange={event => void changePd(project, event.target.value)}>
                <option value="">정하지 않음</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
              : memberName(project.assigneeId)}</td>
          </tr>) : !legacyShown.length ? <tr><td colSpan={4} className="yp-pempty">{all.length ? "찾는 프로젝트가 없어요" : "아직 프로젝트가 없어요. [새 프로젝트]로 첫 주제를 써 보세요."}</td></tr> : null}
        {projects !== null ? legacyShown.map(topic => <tr key={topic.id}>
          <td className="yp-c-name"><div className="yp-pname"><span className="yp-pico yp-anim" aria-hidden="true"><Sparkles size={18} /></span>
            <div style={{ minWidth: 0 }}><button type="button" className="yp-lnk" style={{ textAlign: "left" }} onClick={() => { setMoving(topic); moveDialog.current?.showModal(); }}><b>{topic.title}</b></button>
              <div className="yp-psub"><span className="yp-tag yp-warn">이전 화면에서 진행 중</span><span className="yp-tag">{topic.step}</span></div></div></div></td>
          <td className="yp-c-kind">애니메이션</td><td>{shortDate(topic.updatedAt)}</td><td>{memberName(topic.assigneeId)}</td>
        </tr>) : null}
      </tbody>
    </table></div>
    <p className="yp-hint">최근 수정은 내용을 고쳐 저장했을 때만 바뀌어요. 담당자는 OS 구성원 목록에서 골라요. 안 고르면 주제를 넣은 사람이 들어가요.</p>

    <dialog ref={moveDialog} className="yp-modal" aria-labelledby="yp-move-title" onClose={() => setMoving(null)}>
      <div className="yp-modal-h"><span id="yp-move-title">새 화면으로 옮겨서 이어서 만들기</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => moveDialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><p style={{ marginTop: 0 }}><b>{moving?.title}</b></p>
        <ul className="yp-nowsteps"><li>지금까지 만든 것(기획 · 제목과 썸네일 문구 · 원고 · 완성 영상 · 설명란)이 새 화면의 해당 단계로 들어가요.</li>
          <li>이전 화면에서 승인된 단계는 컨펌 OK로 이어지고, 아직 안 끝난 단계부터 이어서 해요.</li><li>원래 기록은 지우지 않아요. 옮긴 뒤에는 새 화면에서만 이어서 만들어요.</li></ul></div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => moveDialog.current?.close()}>취소</button><button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => void adopt()}>{busy ? "옮기는 중…" : "옮기고 열기"}</button></div>
    </dialog>

    <dialog ref={dialog} className="yp-modal" aria-labelledby="yp-open-title">
      <div className="yp-modal-h"><span id="yp-open-title">프로젝트 열기</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => dialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b">
        <input className="yp-in" id="yp-open-search" placeholder="이름으로 찾기" aria-label="열 프로젝트 이름" autoComplete="off" value={openQuery} onChange={event => setOpenQuery(event.target.value)} />
        <ul className="yp-open-list">{searchProjects([...all].sort((a, b) => projectName(a).localeCompare(projectName(b), "ko")), openQuery).map(project =>
          <li key={project.id}><Link href={projectHref(project)} onClick={() => dialog.current?.close()}>{projectName(project)}</Link> <span className="yp-hint">{stageLabel(project)}</span></li>)}</ul>
      </div>
    </dialog>
  </>;
}

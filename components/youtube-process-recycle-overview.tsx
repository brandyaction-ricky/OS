"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";
import { columnMeta } from "@/lib/seo-column";
import { stepHref, type YpProject } from "@/lib/youtube-process/project";
import { YpSection, type YpPage } from "./youtube-process-frame";

/**
 * 쇼츠 · 칼럼 › 한눈에 확인 (대표 11-21, 「숏폼 5편 + 칼럼 한 번에」): the 숏폼 made from this longform's stretches side by side with the
 * 칼럼. Each one runs by itself to its preview (GPT 기획표, no person's 기획표 확인); here the PD looks once, OKs or leaves a note per 숏폼,
 * makes the OK'd ones' full videos in one press, then asks one approver to confirm the finished ones in one press. Posting stays per screen.
 */
interface Run { id: string; stage: string; status: string; clips?: { name: string }[]; final?: { at: string } | null }
interface Outputs { clips: { label: string; url: string | null }[]; video: string | null }
interface Row { id: string; title: string; seconds: number; project: YpProject | null; run: Run | null; video: string | null; key: string; storyboard?: string }

const WORKING = ["breath_pending", "voice_pending", "words_pending", "words_ready", "storyboard_review", "storyboard_confirmed", "prep_pending", "prep_ready", "clips_pending", "final_pending"];
function stateOf(row: Row) {
  const { run, project } = row;
  if (project?.yp.stage === "review" || project?.yp.stage === "upload" || project?.yp.stage === "done")
    return project.yp.gates.review.state === "wait" ? "컨펌 대기" : project.yp.gates.review.state === "ok" ? "컨펌 끝" : "최종 검토";
  if (!run) return "음성 시작 전";
  if (run.status === "blocked") return "멈춤 · 열어서 확인";
  if (run.stage === "clips_review") return "미리보기 나옴";
  if (run.stage === "final_ready") return "완성됨";
  if (run.stage === "final_pending") return "완성 영상 만드는 중";
  if (run.stage === "words_ready") return row.storyboard === "blocked" ? "기획표 못 만듦" : "기획표 쓰는 중";
  return WORKING.includes(run.stage) ? "미리보기 만드는 중" : "만드는 중";
}

export function RecycleOverview({ page, onColumn }: { page: YpPage; onColumn: () => void }) {
  const items = (page.bundle?.stages.shortTopics.data.recycle?.items ?? []).filter((item) => item.made);
  const columnItem = page.bundle?.stages.column.data.items[0];
  const column = columnItem ? columnMeta(columnItem.html) : null;
  const [rows, setRows] = useState<Row[]>([]);
  const [marks, setMarks] = useState<Record<string, "ok" | "memo">>({});
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [approvers, setApprovers] = useState<string[]>([]);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  const outputsFor = useRef<Record<string, { key: string; video: string | null }>>({});
  const token = page.accessToken, client = page.client;
  const ids = items.map((item) => `${item.id}:${item.made!.projectId}`).join(",");

  const load = useCallback(async () => {
    if (!token || !client) return;
    const list = ids ? ids.split(",").map((pair) => pair.split(":")) : [];
    const next = await Promise.all(list.map(async ([itemId, projectId]) => {
      const item = items.find((row) => row.id === itemId)!;
      const [project, loaded] = await Promise.all([client.get(projectId).catch(() => null),
        apiRequest<{ run: Run | null }>(`/api/v1/content/youtube-automation/myin?sourceId=${projectId}`, { token }).catch(() => ({ run: null }))]);
      const run = loaded.run;
      // Video addresses are signed: ask again only when the clips or the final changed (OS egress, 10-29).
      const key = run && (run.clips?.length || run.final) ? `${run.id}:${(run.clips ?? []).map((clip) => clip.name).join(",")}:${run.final?.at ?? ""}` : "";
      let video = outputsFor.current[projectId]?.key === key ? outputsFor.current[projectId].video : null;
      if (key && outputsFor.current[projectId]?.key !== key) {
        const out = await apiRequest<Outputs>(`/api/v1/content/youtube-automation/myin?outputs=${run!.id}`, { token }).catch(() => null);
        video = out ? out.video ?? out.clips.find((clip) => clip.url)?.url ?? null : null;
        outputsFor.current[projectId] = { key, video };
      }
      // At 받아쓰기 끝 the GPT storyboard is being written, or GPT could not finish it (then 「기획표 다시 만들기」).
      const storyboard = run?.stage === "words_ready" ? await apiRequest<{ job: { status: string } | null }>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${projectId}&task=storyboard`, { token })
        .then((reply) => reply.job?.status, () => undefined) : undefined;
      return { id: projectId, title: item.title.join(" "), seconds: item.seconds, project, run, video, key, storyboard };
    }));
    setRows(next);
    // items is read through ids (the made list); the rest of the bundle changing does not reload the 숏폼.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, client, ids]);
  useEffect(() => { void load(); }, [load]);
  // While any 숏폼 is still being made, look again every 30 s (no new video addresses unless one changed).
  const working = rows.some((row) => ["기획표 쓰는 중", "미리보기 만드는 중", "완성 영상 만드는 중", "만드는 중"].includes(stateOf(row)));
  useEffect(() => { if (!working) return; const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [working, load]);
  useEffect(() => { client?.approvers().then((list) => { setApprovers(list); setTo((current) => current || list[0] || ""); }, () => undefined); }, [client]);

  const ready = rows.filter((row) => stateOf(row) === "미리보기 나옴");
  const okRows = ready.filter((row) => marks[row.id] === "ok"), memoRows = ready.filter((row) => marks[row.id] === "memo" && memos[row.id]?.trim());
  const finished = rows.filter((row) => stateOf(row) === "완성됨" && row.project?.yp.stage === "make");
  const mark = (id: string, value: "ok" | "memo") => setMarks((all) => { const next = { ...all }; if (next[id] === value) delete next[id]; else next[id] = value; return next; });

  const sendPreviews = async () => {
    if (!token) return;
    setBusy("previews"); setDone(""); page.setError("");
    try {
      for (const row of okRows) await apiRequest("/api/v1/content/youtube-automation/myin", { method: "PATCH", token, body: JSON.stringify({ action: "clips_ok", runId: row.run!.id, note: "" }) });
      for (const row of memoRows) await apiRequest("/api/v1/content/youtube-automation/myin", { method: "PATCH", token, body: JSON.stringify({ action: "review", runId: row.run!.id, decision: "revise", note: memos[row.id].trim() }) });
      setDone(`${okRows.length ? `${okRows.length}편 완성 영상을 만들기 시작했어요(편마다 2~3분).` : ""}${memoRows.length ? ` ${memoRows.length}편은 메모대로 기획표를 다시 만들어 미리보기가 새로 나와요.` : ""}`.trim());
      setMarks({}); setMemos({});
      await load();
    } catch (reason) { page.fail(reason); } finally { setBusy(""); }
  };
  const retryStoryboard = async (row: Row) => {
    if (!token || !row.run) return;
    setBusy(`sb:${row.id}`); page.setError("");
    try { await apiRequest("/api/v1/content/youtube-automation/myin", { method: "PATCH", token, body: JSON.stringify({ action: "storyboard_gpt", runId: row.run.id }) }); await load(); }
    catch (reason) { page.fail(reason); } finally { setBusy(""); }
  };
  const askConfirm = async () => {
    if (!client || !to) return;
    setBusy("confirm"); setDone(""); page.setError("");
    try {
      for (const row of finished) {
        const moved = await client.move(row.id, "review", row.project!.version);
        await client.gate(row.id, "review", "request", moved.version, undefined, to);
      }
      setDone(`${finished.length}편을 ${page.members.find((member) => member.id === to)?.name ?? "승인자"}에게 컨펌 요청했어요. 대표 메뉴 › 컨펌 대기에 보여요.`);
      await load();
    } catch (reason) { page.fail(reason); } finally { setBusy(""); }
  };

  if (!items.length) return <YpSection n={1} title="한눈에 확인" gq="숏폼 5편과 칼럼을 한곳에서"><p className="yp-hint">「롱폼에서 뽑기」에서 [5편 모두 만들기]를 누르면 여기에 숏폼이 모여요.</p></YpSection>;
  return <>
    <YpSection n={1} title="숏폼" gq={`${items.length}편 · 롱폼 음성 그대로 · 1.25배`} extra={<button type="button" className="yp-btn yp-sm" onClick={() => void load()}>새로 보기</button>}>
      <p className="yp-hint">숏폼마다 미리보기가 나오면 보고 OK나 메모를 남겨요. 메모는 그 숏폼의 수정 요청이 돼요. 게시는 각 숏폼 화면에서 해요.</p>
      <div className="yp-rv-grid">{(rows.length ? rows : items.map((item) => ({ id: item.made!.projectId, title: item.title.join(" "), seconds: item.seconds, project: null, run: null, video: null, key: "" }))).map((row) => {
        const state = rows.length ? stateOf(row) : "불러오는 중";
        const canMark = state === "미리보기 나옴";
        return <div key={row.id} className="yp-rv-card">
          {row.video ? <video src={row.video} controls preload="metadata" className="yp-rv-video" aria-label={`${row.title} 영상`} /> : <div className="yp-rv-video yp-rv-wait">{state}</div>}
          <b className="yp-rv-title">{row.title}</b>
          <span className="yp-muted">{row.seconds}초 · <span className={state === "멈춤 · 열어서 확인" || state === "기획표 못 만듦" ? "yp-warn-t" : ""}>{state}</span></span>
          {canMark ? <div className="yp-rv-acts">
            <button type="button" className={`yp-btn yp-sm${marks[row.id] === "ok" ? " yp-pri" : ""}`} aria-pressed={marks[row.id] === "ok"} onClick={() => mark(row.id, "ok")}>OK</button>
            <button type="button" className={`yp-btn yp-sm${marks[row.id] === "memo" ? " yp-pri" : ""}`} aria-pressed={marks[row.id] === "memo"} onClick={() => mark(row.id, "memo")}>메모</button></div> : null}
          {state === "기획표 못 만듦" ? <button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void retryStoryboard(row)}>{busy === `sb:${row.id}` ? "보내는 중…" : "기획표 다시 만들기 (GPT)"}</button> : null}
          {marks[row.id] === "memo" ? <textarea className="yp-in" rows={2} value={memos[row.id] ?? ""} placeholder="예) 3번째 장면 글자가 커요" aria-label={`${row.title} 메모`}
            onChange={(event) => setMemos((all) => ({ ...all, [row.id]: event.target.value }))} /> : null}
          <Link className="yp-muted" href={stepHref(3, row.id)}>숏폼 열기 →</Link>
        </div>;
      })}</div>
      <div className="yp-rv-bar">
        <span className="yp-muted">OK {okRows.length} · 메모 {memoRows.length} · 미리보기 나옴 {ready.length} · 완성됨 {finished.length}</span>
        <span className="yp-sp" />
        <button type="button" className="yp-btn yp-sm yp-pri" disabled={Boolean(busy) || !okRows.length && !memoRows.length} onClick={() => void sendPreviews()}>
          {busy === "previews" ? "보내는 중…" : `OK ${okRows.length}편 완성 영상 만들기${memoRows.length ? ` · 메모 ${memoRows.length}편 수정 요청` : ""}`}</button>
        {finished.length ? <>
          {approvers.length ? <select className="yp-in yp-sel1" value={to} onChange={(event) => setTo(event.target.value)} aria-label="컨펌 요청할 사람">
            {approvers.map((id) => <option key={id} value={id}>{page.members.find((member) => member.id === id)?.name ?? "대표"}</option>)}</select> : <span className="yp-muted">회사 승인자가 아직 없어요</span>}
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={Boolean(busy) || !to} onClick={() => void askConfirm()}>{busy === "confirm" ? "요청하는 중…" : `완성된 ${finished.length}편 컨펌 요청`}</button></> : null}
      </div>
      {done ? <p className="yp-hint" role="status">{done}</p> : null}
    </YpSection>
    <YpSection n={2} title="SEO 칼럼" gq={column ? "칼럼 초안이 있어요" : "아직 없어요"} extra={<button type="button" className="yp-btn yp-sm" onClick={onColumn}>칼럼 열기 →</button>}>
      {column ? <div className="yp-recycle"><b>{column.title}</b><p className="yp-muted">{column.description}</p></div>
        : <p className="yp-hint">「롱폼에서 뽑기」의 [숏폼 5편 + 칼럼 한 번에 만들기]를 누르면 칼럼 초안도 함께 써요. 칼럼은 SEO 칼럼 탭에서 고치고 마이인으로 내보내요.</p>}
    </YpSection>
  </>;
}

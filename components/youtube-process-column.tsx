"use client";
/* eslint-disable @next/next/no-img-element -- private signed previews do not have stable optimizer URLs */
import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Code2, Download, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { checkColumnHtml, columnSlots, renderColumn, type ColumnFill } from "@/lib/seo-column";
import type { YpColumn } from "@/lib/youtube-process/stages";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { md, YpSection, type YpPage } from "./youtube-process-frame";

const slotName = (slot: string) => slot === "hero" ? "대표 이미지" : slot === "video" ? "영상" : `이미지 ${slot}`;
/** What each place shows: an address as it is, an uploaded image through `images` (signed link or data: URI), and the uploaded video by default. */
function resolveFills(fills: YpColumn["fills"], images: Record<string, string>, videoUrl: string) {
  const out: Record<string, ColumnFill> = {};
  for (const [slot, fill] of Object.entries(fills)) { const src = fill.url ?? (fill.path ? images[fill.path] : ""); if (src) out[slot] = { src }; }
  if (!out.video && videoUrl) out.video = { src: videoUrl };
  return out;
}
const dataUri = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });

/** 쇼츠 · 칼럼 › SEO 칼럼 (owner request 2026-10-25): my AI writes the column from the final 원고, the PD fills its image places and exports it. */
export function YoutubeColumnPanel({ page }: { page: YpPage }) {
  const bundle = page.bundle!;
  const project = bundle.project;
  const column = bundle.stages.column;
  const { html, fills, ai, aiDraft } = column.data;
  const videoUrl = bundle.stages.upload.data.run?.videoUrl ?? "";
  const [send, setSend] = useState(false);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const job = useStaffJob(page, "column", () => void page.reload());
  const check = useMemo(() => html ? checkColumnHtml(html) : null, [html]);
  const slots = useMemo(() => columnSlots(html), [html]);
  const preview = useMemo(() => html ? renderColumn(html, resolveFills(fills, signed, videoUrl)) : "", [html, fills, signed, videoUrl]);

  useEffect(() => {
    const paths = Object.values(fills).map(fill => fill.path).filter((path): path is string => Boolean(path && !signed[path]));
    if (!paths.length || !page.client) return;
    let active = true;
    Promise.all(paths.map(async path => [path, await page.client!.assetUrl(project.id, path)] as const))
      .then(rows => { if (active) setSigned(current => ({ ...current, ...Object.fromEntries(rows) })); }, () => undefined);
    return () => { active = false; };
  }, [fills, signed, page.client, project.id]);

  const save = async (patch: Record<string, unknown>, label: string) => {
    if (!page.client) return false;
    setBusy(label); page.setError("");
    try {
      const result = await page.client.saveStage(project.id, "column", column.version, patch);
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, column: result.stage } } : current);
      return true;
    } catch (reason) { page.fail(reason); return false; } finally { setBusy(""); }
  };
  const upload = async (slot: string, file: File) => {
    if (!page.client) return;
    setBusy(`fill-${slot}`);
    try { const asset = await page.client.uploadAsset(project.id, "column", file); await save({ fill: { slot, path: asset.path, name: asset.name } }, `fill-${slot}`); }
    catch (reason) { page.fail(reason); setBusy(""); }
  };
  const applyUrl = async (slot: string) => {
    if (await save({ fill: { slot, url: (urls[slot] ?? "").trim() } }, `fill-${slot}`)) setUrls(current => ({ ...current, [slot]: "" }));
  };
  // The exported page carries the uploaded images inside it (data: URIs), so the one file opens anywhere.
  const exportHtml = async () => {
    const images: Record<string, string> = {};
    for (const fill of Object.values(fills)) if (fill.path) images[fill.path] = await dataUri(await (await fetch(signed[fill.path] ?? await page.client!.assetUrl(project.id, fill.path))).blob());
    return renderColumn(html, resolveFills(fills, images, videoUrl));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(await exportHtml()); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch (reason) { page.fail(reason); }
  };
  const download = async () => {
    try {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([await exportHtml()], { type: "text/html;charset=utf-8" }));
      link.download = `${check?.meta.slug || "seo-column"}.html`;
      link.click(); URL.revokeObjectURL(link.href);
    } catch (reason) { page.fail(reason); }
  };
  const flagged = check ? [...check.unsafe, ...check.issues] : [];

  return <>
    <YpSection n={1} title="SEO 칼럼" gq={ai ? `${ai.by}의 AI · ${ai.model} · ${md(ai.at)}` : "구성안 원고로 검색용 웹 칼럼을 써요"} extra={<>
      <button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || job.open} onClick={() => setSend(true)}><Sparkles size={14} /> {html ? "내 AI로 다시 쓰기" : "내 AI로 칼럼 쓰기"}</button>
      <button type="button" className="yp-btn yp-sm" onClick={() => setEditing(editing === null ? html : null)}><Code2 size={14} /> {html ? "HTML 고치기" : "HTML 붙여 넣기"}</button></>}>
      {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
      {aiDraft ? <div className="yp-note"><div>내 AI가 새 초안을 냈어요. 지금 칼럼은 사람이 고친 것이라 그대로 두었어요. <button type="button" className="yp-lnk" disabled={busy === "draft"} onClick={() => void save({ useAiDraft: true }, "draft")}>이 초안으로 바꾸기</button></div></div> : null}
      {!html ? <p className="yp-pempty">아직 칼럼이 없어요. [내 AI로 칼럼 쓰기]를 누르면 내 Claude가 구성안 원고를 읽고 SEO 칼럼 정본대로 HTML을 써요.</p> : check ? <>
        <dl className="yp-kv">
          <dt>제목</dt><dd>{check.meta.title || "—"}</dd>
          <dt>주소</dt><dd><code>{check.meta.slug || "—"}</code></dd>
          <dt>설명</dt><dd>{check.meta.description || "—"} <span className="yp-muted">({check.meta.description.length}자)</span></dd>
          <dt>키워드</dt><dd>{check.meta.keywords.join(" · ") || "—"}</dd>
        </dl>
        {flagged.length ? <div className="yp-errline" role="status">정본 구성과 다른 곳 {flagged.length}건: {flagged.join(" / ")}</div>
          : <p className="yp-hint"><Check size={12} aria-hidden="true" /> 정본 구성 검사를 통과했어요</p>}
      </> : null}
      {editing !== null ? <div style={{ marginTop: 10 }}>
        <textarea className="yp-in" rows={18} value={editing} onChange={event => setEditing(event.target.value)} aria-label="칼럼 HTML" style={{ width: "100%", fontFamily: "var(--mono, monospace)", fontSize: 12 }} />
        <div className="yp-savebar"><span className="yp-hint">스크립트 · 스타일 · iframe은 저장되지 않아요. 디자인은 OS가 입혀요.</span><span className="yp-sp" />
          <button type="button" className="yp-btn yp-sm" onClick={() => setEditing(null)}>취소</button>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy === "html" || editing === html} onClick={async () => { if (await save({ html: editing }, "html")) setEditing(null); }}>저장</button></div>
      </div> : null}
    </YpSection>

    {html ? <YpSection n={2} title="이미지 · 영상 자리" gq="프롬프트를 이미지 AI에 붙여 넣어 만든 뒤 올려요">
      {slots.length ? <ul className="yp-hist">{slots.map(info => {
        const fill = fills[info.slot];
        const shown = fill?.url ?? (fill?.path ? signed[fill.path] : "");
        const video = info.kind === "video";
        return <li key={info.slot} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 280px", minWidth: 0 }}><b>{slotName(info.slot)}</b> <span className="yp-muted">{info.caption}</span><br />
            {video ? <span className="yp-muted" style={{ fontSize: 12 }}>{fill?.url ? `넣은 영상: ${fill.url}` : videoUrl ? `올린 영상이 들어가요: ${videoUrl}` : "유튜브에 올린 뒤 영상이 자동으로 들어가요. 다른 영상은 주소를 넣어요."}</span>
              : <span className="yp-muted" style={{ fontSize: 12, wordBreak: "break-word" }}>{info.prompt}</span>}
            {shown && !video ? <><br /><img src={shown} alt="" style={{ maxWidth: 220, maxHeight: 124, borderRadius: 8, marginTop: 6, objectFit: "cover" }} /></> : null}</span>
          <span className="yp-row-btns" style={{ flexWrap: "wrap" }}>
            {video ? null : <>
              <button type="button" className="yp-btn yp-sm" onClick={() => void navigator.clipboard.writeText(info.prompt)}><Clipboard size={14} /> 프롬프트 복사</button>
              <label className="yp-btn yp-sm" style={{ cursor: "pointer" }}><ImagePlus size={14} /> {busy === `fill-${info.slot}` ? "올리는 중…" : "이미지 올리기"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(info.slot, file); }} /></label></>}
            <input className="yp-in" style={{ width: 200 }} placeholder={video ? "유튜브 주소" : "이미지 주소 (https)"} value={urls[info.slot] ?? ""} aria-label={`${slotName(info.slot)} 주소`}
              onChange={event => setUrls(current => ({ ...current, [info.slot]: event.target.value }))} />
            <button type="button" className="yp-btn yp-sm" disabled={!urls[info.slot]?.trim() || busy === `fill-${info.slot}`} onClick={() => void applyUrl(info.slot)}>주소 넣기</button>
            {fill ? <button type="button" className="yp-ib" aria-label={`${slotName(info.slot)} 빼기`} onClick={() => void save({ fill: { slot: info.slot } }, `fill-${info.slot}`)}><Trash2 size={14} /></button> : null}
          </span>
        </li>;
      })}</ul> : <p className="yp-hint">이 칼럼에는 이미지 자리가 없어요.</p>}
    </YpSection> : null}

    {html ? <YpSection n={3} title="미리보기 · 내보내기" gq="디자인 · 왼쪽 목차 · 검색용 구조 정보(JSON-LD)는 OS가 입혀요" extra={<>
      <button type="button" className="yp-btn yp-sm" onClick={() => void copy()}><Clipboard size={14} /> {copied ? "복사했어요" : "HTML 복사"}</button>
      <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => void download()}><Download size={14} /> HTML 내려받기</button></>}>
      <iframe title="SEO 칼럼 미리보기" sandbox="allow-scripts allow-popups" srcDoc={preview} style={{ width: "100%", height: 880, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
      <p className="yp-hint">내보낸 파일에는 올린 이미지가 함께 들어가요. 자사 웹에 올릴 때 그곳의 이미지 주소를 쓰려면 [주소 넣기]로 바꿔요.</p>
    </YpSection> : null}
    <SendDialog page={page} task="column" open={send} onClose={() => setSend(false)} job={job} />
  </>;
}

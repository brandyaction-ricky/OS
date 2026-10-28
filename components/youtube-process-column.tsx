"use client";
/* eslint-disable @next/next/no-img-element -- private signed previews do not have stable optimizer URLs */
import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Code2, Download, ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { checkColumnHtml, columnMeta, columnSlots, renderColumn, type ColumnFill } from "@/lib/seo-column";
import { columnSignature, type YpColumnItem } from "@/lib/youtube-process/stages";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { md, YpSection, type YpPage } from "./youtube-process-frame";

const slotName = (slot: string) => slot === "hero" ? "대표 이미지" : slot === "video" ? "영상" : `이미지 ${slot}`;
/** What each place shows: an address as it is, an uploaded image through `images` (signed link or data: URI), and the uploaded video by default. */
function resolveFills(fills: YpColumnItem["fills"], images: Record<string, string>, videoUrl: string) {
  const out: Record<string, ColumnFill> = {};
  for (const [slot, fill] of Object.entries(fills)) { const src = fill.url ?? (fill.path ? images[fill.path] : ""); if (src) out[slot] = { src }; }
  if (!out.video && videoUrl) out.video = { src: videoUrl };
  return out;
}
const dataUri = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
type Save = (patch: Record<string, unknown>, label: string) => Promise<boolean>;

/** 쇼츠 · 칼럼 › SEO 칼럼 (owner request 2026-10-25): my AI writes as many columns as asked from the final 원고; each is filled and exported on its own. */
export function YoutubeColumnPanel({ page }: { page: YpPage }) {
  const bundle = page.bundle!;
  const project = bundle.project;
  const column = bundle.stages.column;
  const items = column.data.items;
  const videoUrl = bundle.stages.upload.data.run?.videoUrl ?? "";
  const [send, setSend] = useState(false);
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [pasting, setPasting] = useState<string | null>(null);
  const job = useStaffJob(page, "column", () => void page.reload());
  const current = items.find(item => item.id === pick) ?? items[0] ?? null;

  const save: Save = async (patch, label) => {
    if (!page.client) return false;
    setBusy(label); page.setError("");
    try {
      const result = await page.client.saveStage(project.id, "column", column.version, patch);
      page.setBundle(state => state ? { ...state, project: result.project, stages: { ...state.stages, column: result.stage } } : state);
      return true;
    } catch (reason) { page.fail(reason); return false; } finally { setBusy(""); }
  };
  const addPasted = async () => {
    if (pasting === null || !(await save({ html: pasting }, "paste"))) return;
    setPasting(null); setPick(null);
  };

  return <>
    <YpSection n={1} title="SEO 칼럼" gq={items.length ? `${items.length}편 · 편마다 다른 검색 질문` : "원고로 검색용 칼럼을 써요"} extra={<>
      <button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || job.open} onClick={() => setSend(true)}><Sparkles size={14} /> {items.length ? "다시 자동으로 쓰기" : "칼럼 자동으로 쓰기"}</button>
      <button type="button" className="yp-btn yp-sm" onClick={() => setPasting(pasting === null ? "" : null)}><Plus size={14} /> HTML 붙여 넣기</button></>}>
      {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
      {!items.length ? <p className="yp-pempty">아직 칼럼이 없어요. [칼럼 자동으로 쓰기]를 눌러 시작해요.</p>
        : <div className="yp-ftabs" role="tablist" aria-label="칼럼" style={{ padding: "0 0 10px" }}>{items.map((item, index) =>
          <button key={item.id} type="button" role="tab" aria-selected={current?.id === item.id} className={current?.id === item.id ? "yp-on" : ""} onClick={() => setPick(item.id)}>
            칼럼 {index + 1}{columnMeta(item.html).title ? ` · ${columnMeta(item.html).title.slice(0, 16)}` : ""}</button>)}</div>}
      {items.length ? <p className="yp-hint" style={{ marginTop: 0 }}>다시 쓰면 고친 칼럼은 남고 나머지는 새로 바뀌어요.</p> : null}
      {pasting !== null ? <div style={{ marginTop: 8 }}>
        <textarea className="yp-in" rows={12} value={pasting} onChange={event => setPasting(event.target.value)} aria-label="새 칼럼 HTML" placeholder="다른 곳에서 쓴 칼럼 HTML을 붙여 넣어요" style={{ width: "100%", fontFamily: "var(--mono, monospace)", fontSize: 12 }} />
        <div className="yp-savebar"><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" onClick={() => setPasting(null)}>취소</button>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy === "paste" || !pasting.trim()} onClick={() => void addPasted()}>새 칼럼으로 넣기</button></div>
      </div> : null}
    </YpSection>
    {current ? <ColumnItemView key={current.id} page={page} item={current} index={items.indexOf(current)} videoUrl={videoUrl} busy={busy} save={save} /> : null}
    <SendDialog page={page} task="column" open={send} onClose={() => setSend(false)} job={job} />
  </>;
}

/** One column: its check, image places, preview and export. */
function ColumnItemView({ page, item, index, videoUrl, busy, save }: { page: YpPage; item: YpColumnItem; index: number; videoUrl: string; busy: string; save: Save }) {
  const projectId = page.bundle!.project.id;
  const { html, fills, ai } = item;
  const [editing, setEditing] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const check = useMemo(() => checkColumnHtml(html), [html]);
  const slots = useMemo(() => columnSlots(html), [html]);
  const preview = useMemo(() => renderColumn(html, resolveFills(fills, signed, videoUrl)), [html, fills, signed, videoUrl]);
  const patch = (body: Record<string, unknown>, label: string) => save({ item: item.id, ...body }, label);

  useEffect(() => {
    const paths = Object.values(fills).map(fill => fill.path).filter((path): path is string => Boolean(path && !signed[path]));
    if (!paths.length || !page.client) return;
    let active = true;
    Promise.all(paths.map(async path => [path, await page.client!.assetUrl(projectId, path)] as const))
      .then(rows => { if (active) setSigned(current => ({ ...current, ...Object.fromEntries(rows) })); }, () => undefined);
    return () => { active = false; };
  }, [fills, signed, page.client, projectId]);

  const upload = async (slot: string, file: File) => {
    if (!page.client) return;
    try { const asset = await page.client.uploadAsset(projectId, "column", file); await patch({ fill: { slot, path: asset.path, name: asset.name } }, `fill-${slot}`); }
    catch (reason) { page.fail(reason); }
  };
  const applyUrl = async (slot: string) => {
    if (await patch({ fill: { slot, url: (urls[slot] ?? "").trim() } }, `fill-${slot}`)) setUrls(current => ({ ...current, [slot]: "" }));
  };
  // The exported page carries the uploaded images inside it (data: URIs), so the one file opens anywhere.
  const exportHtml = async () => {
    const images: Record<string, string> = {};
    for (const fill of Object.values(fills)) if (fill.path) images[fill.path] = await dataUri(await (await fetch(signed[fill.path] ?? await page.client!.assetUrl(projectId, fill.path))).blob());
    return renderColumn(html, resolveFills(fills, images, videoUrl));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(await exportHtml()); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch (reason) { page.fail(reason); }
  };
  const download = async () => {
    try {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([await exportHtml()], { type: "text/html;charset=utf-8" }));
      link.download = `${check.meta.slug || `seo-column-${index + 1}`}.html`;
      link.click(); URL.revokeObjectURL(link.href);
    } catch (reason) { page.fail(reason); }
  };
  const flagged = [...check.unsafe, ...check.issues];

  return <>
    <YpSection n={2} title={`칼럼 ${index + 1}`} gq={ai ? `자동 작성본 · ${ai.by} · ${md(ai.at)}${html !== ai.html ? " · 고침" : ""}` : "붙여 넣은 칼럼"} extra={<>
      <button type="button" className="yp-btn yp-sm" onClick={() => setEditing(editing === null ? html : null)}><Code2 size={14} /> HTML 고치기</button>
      <button type="button" className="yp-ib" aria-label={`칼럼 ${index + 1} 빼기`} disabled={busy === "remove"} onClick={() => { if (window.confirm("이 칼럼을 뺄까요?")) void patch({ remove: true }, "remove"); }}><Trash2 size={14} /></button></>}>
      <dl className="yp-kv">
        <dt>제목</dt><dd>{check.meta.title || "—"}</dd>
        <dt>주소</dt><dd><code>{check.meta.slug || "—"}</code></dd>
        <dt>설명</dt><dd>{check.meta.description || "—"} <span className="yp-muted">({check.meta.description.length}자)</span></dd>
        <dt>키워드</dt><dd>{check.meta.keywords.join(" · ") || "—"}</dd>
      </dl>
      {flagged.length ? <div className="yp-errline" role="status">형식 점검: {flagged.length}곳 확인 필요 — {flagged.join(" / ")}</div>
        : <p className="yp-hint"><Check size={12} aria-hidden="true" /> 형식 점검 통과</p>}
      {editing !== null ? <div style={{ marginTop: 10 }}>
        <textarea className="yp-in" rows={18} value={editing} onChange={event => setEditing(event.target.value)} aria-label="칼럼 HTML" style={{ width: "100%", fontFamily: "var(--mono, monospace)", fontSize: 12 }} />
        <div className="yp-savebar"><span className="yp-hint">디자인은 자동으로 입혀요.</span><span className="yp-sp" />
          <button type="button" className="yp-btn yp-sm" onClick={() => setEditing(null)}>취소</button>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy === "html" || editing === html} onClick={async () => { if (await patch({ html: editing }, "html")) setEditing(null); }}>저장</button></div>
      </div> : null}
    </YpSection>

    <YpSection n={3} title="이미지 · 영상 자리" gq="지시 문장을 이미지 만드는 AI에 붙여 넣어 만든 뒤 올려요">
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
              <button type="button" className="yp-btn yp-sm" onClick={() => void navigator.clipboard.writeText(info.prompt)}><Clipboard size={14} /> 지시 문장 복사</button>
              <label className="yp-btn yp-sm" style={{ cursor: "pointer" }}><ImagePlus size={14} /> {busy === `fill-${info.slot}` ? "올리는 중…" : "이미지 올리기"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(info.slot, file); }} /></label></>}
            <input className="yp-in" style={{ width: 200 }} placeholder={video ? "유튜브 주소" : "이미지 주소 (https)"} value={urls[info.slot] ?? ""} aria-label={`${slotName(info.slot)} 주소`}
              onChange={event => setUrls(current => ({ ...current, [info.slot]: event.target.value }))} />
            <button type="button" className="yp-btn yp-sm" disabled={!urls[info.slot]?.trim() || busy === `fill-${info.slot}`} onClick={() => void applyUrl(info.slot)}>주소 넣기</button>
            {fill ? <button type="button" className="yp-ib" aria-label={`${slotName(info.slot)} 빼기`} onClick={() => void patch({ fill: { slot: info.slot } }, `fill-${info.slot}`)}><Trash2 size={14} /></button> : null}
          </span>
        </li>;
      })}</ul> : <p className="yp-hint">이 칼럼에는 이미지 자리가 없어요.</p>}
    </YpSection>

    <YpSection n={4} title="미리보기 · 내보내기" extra={<>
      <button type="button" className="yp-btn yp-sm" onClick={() => void copy()}><Clipboard size={14} /> {copied ? "복사했어요" : "HTML 복사"}</button>
      <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => void download()}><Download size={14} /> HTML 내려받기</button></>}>
      <iframe title={`칼럼 ${index + 1} 미리보기`} sandbox="allow-scripts allow-popups" srcDoc={preview} style={{ width: "100%", height: 880, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
      <p className="yp-hint">이미지는 파일 안에 함께 들어가요.</p>
    </YpSection>
    <ColumnMyin page={page} item={item} issues={check.issues.length} blocked={check.unsafe.length > 0} />
  </>;
}

/** 마이인 칼럼 (owner decision 2026-10-25, 「초안 → 공개 버튼」): sent to the MYIN 아티클 as a draft, checked in the preview above, then made public here. */
function ColumnMyin({ page, item, issues, blocked }: { page: YpPage; item: YpColumnItem; issues: number; blocked: boolean }) {
  const [busy, setBusy] = useState("");
  const sent = item.myin, published = sent?.status === "published", changed = Boolean(sent && sent.sig !== columnSignature(item));
  const act = async (action: "send" | "publish" | "unpublish") => {
    const bundle = page.bundle;
    if (!page.client || !bundle) return;
    if (action === "publish" && !window.confirm("마이인 칼럼에 공개할까요? 누구나 볼 수 있게 돼요.")) return;
    setBusy(action); page.setError("");
    try {
      const result = await page.client.columnMyin(bundle.project.id, item.id, action, bundle.stages.column.version);
      page.setBundle(state => state ? { ...state, project: result.project, stages: { ...state.stages, column: result.stage } } : state);
    } catch (reason) { page.fail(reason); } finally { setBusy(""); }
  };
  return <YpSection n={5} title="마이인 칼럼" gq={!sent ? "임시 글로 올리고, 위 미리보기로 확인한 뒤 공개해요" : published ? "공개 중" : "임시 글 · 공개 전"}>
    {sent ? <dl className="yp-kv" style={{ marginBottom: 10 }}>
      <dt>상태</dt><dd><span className={`yp-tag ${published ? "yp-ok" : "yp-acc"}`}>{published ? "공개" : "임시 글"}</span> {md(sent.at)} · {sent.by}{changed ? <> <span className="yp-tag yp-warn">보낸 뒤 고침</span></> : null}</dd>
      <dt>주소</dt><dd>{published ? <a href={sent.url} target="_blank" rel="noreferrer">{sent.url}</a> : <span className="yp-muted">{sent.url} (공개하면 열려요)</span>}</dd>
    </dl> : null}
    <div className="yp-row-btns" style={{ marginTop: 0 }}>
      <button type="button" className={`yp-btn${!sent || changed ? " yp-pri" : ""}`} disabled={Boolean(busy) || blocked} onClick={() => void act("send")}>
        {busy === "send" ? "처리 중…" : !sent ? "마이인에 임시 글로 올리기" : changed ? "고친 내용 다시 보내기" : "다시 보내기"}</button>
      {sent && !published ? <button type="button" className="yp-btn yp-pri" disabled={Boolean(busy) || changed} title={changed ? "고친 내용을 먼저 보내 주세요" : undefined} onClick={() => void act("publish")}>{busy === "publish" ? "처리 중…" : "공개하기"}</button> : null}
      {published ? <button type="button" className="yp-btn" disabled={Boolean(busy)} onClick={() => void act("unpublish")}>{busy === "unpublish" ? "처리 중…" : "비공개로 돌리기"}</button> : null}
    </div>
    {blocked ? <p className="yp-hint">실행 코드가 있어 보낼 수 없어요. HTML을 고쳐 주세요.</p>
      : issues ? <p className="yp-hint">형식 점검에서 {issues}곳 확인이 필요해요. 고친 뒤 보내는 게 좋아요.</p> : null}
  </YpSection>;
}

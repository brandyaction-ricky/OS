"use client";
/* eslint-disable @next/next/no-img-element -- Generated blob previews cannot use Next image optimization. */

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest, generateContent, updateRecord } from "@/lib/api-client";
import { PIPELINE_GATES, pipelineArtifacts, usesShootingPlan, type PipelineAction, type PipelineReview, type PipelineRun } from "@/lib/content-pipeline";
import type { OsRecord } from "@/lib/record-types";
import type { YoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION, youtubeCharacterAssetRoleLabels, type YoutubeCharacterAssetRole } from "@/lib/youtube-visual-template";
import { useSession } from "./session-provider";

interface PipelineState { source: OsRecord; records: OsRecord[]; reviews: PipelineReview[]; signatures: string[]; approved: boolean[]; missing: string[][] }
interface VoiceRun { id: string; sourceId: string; status: string; stage: string; segmentCount: number; segmentsReady: number; readyIndexes: number[]; needsAttention: string[]; lastErrorCode: string | null; createdAt: string; updatedAt: string }
const ACTIONS: Array<{ action: PipelineAction; label: string; gate: number }> = [
  { action: "topic_plan", label: "기획 브리핑 생성", gate: 0 }, { action: "title_package", label: "제목·썸네일 생성", gate: 0 },
  { action: "script_draft", label: "원고 생성", gate: 1 }, { action: "shorts_proposal", label: "숏폼 구간 제안", gate: 2 }, { action: "youtube_kit", label: "발행키트 생성", gate: 2 },
];
const FACTORY_PHASES = [
  { title: "1. 기획·패키징", steps: ["주제 접수", "근거·타깃 확인", "기획 브리핑", "제목·썸네일 선택", "시청자에게 할 약속 검토"] },
  { title: "2. 설계·제작 자료", steps: ["내용 구성", "원고 또는 촬영 진행표", "팩트·브랜드 언어 점검", "제작 자료 검토"] },
  { title: "3. 제작 자산", steps: ["보이스 MP3", "이미지", "캐릭터", "자막", "편집 사양"] },
  { title: "4. 영상", steps: ["초벌 렌더", "영상 검수", "수정 반영", "최종 MP4"] },
  { title: "5. 발행·학습", steps: ["발행키트", "최종 승인", "발행", "성과 수집"] },
] as const;

export function ContentPipelinePanel({ sourceId, onChange }: { sourceId: string; onChange: () => Promise<void> }) {
  const { accessToken, profile } = useSession();
  const [state, setState] = useState<PipelineState | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [voicePlan, setVoicePlan] = useState<YoutubeAutomationPlan | null>(null);
  const [pilotAvailable, setPilotAvailable] = useState(false);
  const [voicePreviewConfigured, setVoicePreviewConfigured] = useState(false);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voicePreviewKey, setVoicePreviewKey] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imagePreviewKey, setImagePreviewKey] = useState("");
  const [voiceRuns, setVoiceRuns] = useState<VoiceRun[]>([]);
  const [voiceRunAudioUrl, setVoiceRunAudioUrl] = useState("");
  const load = useCallback(async () => {
    const data = await apiRequest<PipelineState>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken }); setState(data);
    try {
      const automation = await apiRequest<{ plan: YoutubeAutomationPlan; voicePreviewConfigured: boolean }>(`/api/v1/content/youtube-automation?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken });
      setVoicePlan(automation.plan); setVoicePreviewConfigured(automation.voicePreviewConfigured); setPilotAvailable(true);
      try {
        const history = await apiRequest<{ runs: VoiceRun[] }>(`/api/v1/content/youtube-automation/runs?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken });
        setVoiceRuns(history.runs);
      } catch { setVoiceRuns([]); }
    } catch { setVoicePlan(null); setVoicePreviewConfigured(false); setPilotAvailable(false); setVoiceRuns([]); }
  }, [accessToken, sourceId]);
  useEffect(() => { setState(null); load().catch((reason) => setError(String(reason.message))); }, [load]);
  useEffect(() => () => { if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl); }, [voicePreviewUrl]);
  useEffect(() => () => { if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl); }, [imagePreviewUrl]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); await load(); await onChange(); } catch (reason) { setError(reason instanceof Error ? reason.message : "공정을 처리하지 못했습니다."); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!state) return;
    const form = new FormData(event.currentTarget);
    void perform(() => updateRecord(accessToken, { id: sourceId, expectedVersion: state.source.version, metadata: { ...state.source.metadata, pipelineEnabled: true,
      productionPreparation: { kind: String(form.get("preparationKind") ?? "full_script"), design: String(form.get("design") ?? "").trim(), shootingPlan: String(form.get("shootingPlan") ?? "").trim() },
      productionLine: String(form.get("productionLine") ?? "A").trim(), sourceType: String(form.get("sourceType") ?? "longform").trim(), packageId: String(form.get("packageId") ?? sourceId).trim(), rulesVersion: String(form.get("rulesVersion") ?? "v1").trim(),
      audience: String(form.get("audience") ?? "").trim(), evidence: String(form.get("evidence") ?? "").trim(), experience: String(form.get("experience") ?? "").trim(), voiceUrl: String(form.get("voiceUrl") ?? "").trim(), imageFolderUrl: String(form.get("imageFolderUrl") ?? "").trim(), characterUrl: String(form.get("characterUrl") ?? "").trim(), editSpecUrl: String(form.get("editSpecUrl") ?? "").trim(), finalVideoUrl: String(form.get("finalVideoUrl") ?? "").trim() } }));
  };
  const previewVoice = async () => {
    if (!voicePlan?.inputKey) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/content/youtube-automation", {
        method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ sourceId, inputKey: voicePlan.inputKey }), cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: { message?: string }; message?: string };
        throw new Error(result.error?.message || result.message || "목소리 미리듣기를 만들지 못했습니다.");
      }
      setVoicePreviewUrl(URL.createObjectURL(await response.blob()));
      setVoicePreviewKey(voicePlan.inputKey);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "목소리 미리듣기를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };
  const generateScenes = async () => {
    if (!voicePlan?.inputKey) return;
    setImagePreviewUrl(""); setImagePreviewKey("");
    await perform(() => apiRequest("/api/v1/content/youtube-automation/scenes", {
      method: "POST", token: accessToken, body: JSON.stringify({ sourceId, inputKey: voicePlan.inputKey }),
    }));
  };
  const previewImage = async (segmentIndex: number) => {
    if (!voicePlan?.inputKey) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/content/youtube-automation/image-preview", {
        method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ sourceId, inputKey: voicePlan.inputKey, segmentIndex }), cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(result.error?.message || "화면 이미지를 만들지 못했습니다.");
      }
      setImagePreviewUrl(URL.createObjectURL(await response.blob()));
      setImagePreviewKey(voicePlan.inputKey);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "화면 이미지를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };
  const queueVoice = async () => {
    if (!voicePlan?.inputKey) return;
    await perform(() => apiRequest("/api/v1/content/youtube-automation/runs", {
      method: "POST", token: accessToken, body: JSON.stringify({ sourceId, inputKey: voicePlan.inputKey }),
    }));
  };
  const listenVoiceSegment = async (runId: string, segmentIndex: number) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ sourceId, runId, segmentIndex: String(segmentIndex) });
      const result = await apiRequest<{ url: string }>(`/api/v1/content/youtube-automation/runs?${params}`, { token: accessToken });
      setVoiceRunAudioUrl(result.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "음성을 열지 못했습니다."); }
    finally { setBusy(false); }
  };
  if (!state || state.source.id !== sourceId) return <section className="panel pipeline-panel"><p>{error || "공정 불러오는 중…"}</p></section>;
  const artifacts = pipelineArtifacts(state.records);
  const enabled = state.source.metadata.pipelineEnabled === true;
  const planMode = usesShootingPlan(state.source);
  const preparation = (state.source.metadata.productionPreparation ?? {}) as Record<string, unknown>;
  const scenePlan = (state.source.metadata.narratedScenePlan ?? null) as { inputKey?: string; templateVersion?: string; plan?: { visualDirection?: string; scenes?: Array<{ segmentIndex: number; layoutTemplate: string; visualType: string; characterAssetRole?: YoutubeCharacterAssetRole | null; visualBeats?: Array<{ spokenAnchor: string; visualAction: string; graphicSpec: string; displayText: string }>; visualPrompt: string; onScreenText: string; evidenceNote: string }>; unresolved?: string[] } } | null;
  const currentScenePlan = scenePlan && voicePlan?.inputKey && scenePlan.inputKey === voicePlan.inputKey &&
    scenePlan.templateVersion === YOUTUBE_VISUAL_TEMPLATE_VERSION ? scenePlan.plan : null;
  const firstGeneratedScene = currentScenePlan?.scenes?.find((scene) => scene.visualType === "generated_still");
  const actions = ACTIONS.filter((item) => !planMode || item.action !== "script_draft");
  const runs = (Array.isArray(state.source.metadata.pipelineRuns) ? state.source.metadata.pipelineRuns : []) as PipelineRun[];
  return <section className="panel pipeline-panel">
    <header><h2>콘텐츠 제작 공정</h2><p>제목·썸네일을 먼저 정한 뒤 제작 자료를 준비합니다. 칠판형에는 전문 원고가 필요하지 않습니다.</p><button className="ghost-button" disabled={busy} onClick={() => void perform(load)}>새로 불러오기</button></header>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    <form key={sourceId} onSubmit={save} className="pipeline-inputs">
      <div className="form-grid"><label>제작 라인<select name="productionLine" defaultValue={String(state.source.metadata.productionLine ?? "A")}><option value="A">A · 롱폼에서 숏폼</option><option value="B">B · 숏폼 직접 제작</option></select></label><label>원본 유형<select name="sourceType" defaultValue={String(state.source.metadata.sourceType ?? "longform")}><option value="longform">롱폼 원본</option><option value="script">승인 원고</option><option value="idea">아이디어 직접 제작</option></select></label></div>
      <div className="form-grid"><label>패키지 ID<input name="packageId" defaultValue={String(state.source.metadata.packageId ?? sourceId)} /></label><label>규칙 버전<input name="rulesVersion" defaultValue={String(state.source.metadata.rulesVersion ?? "v1")} /></label></div>
      <label>타깃 시청자<input required name="audience" defaultValue={String(state.source.metadata.audience ?? "")} /></label>
      <label>확인한 자료·출처<textarea required name="evidence" rows={4} defaultValue={String(state.source.metadata.evidence ?? "")} placeholder="자료 링크와 직접 확인한 사실을 적어주세요." /></label>
      <label>실제 경험·사례<textarea required name="experience" rows={3} defaultValue={String(state.source.metadata.experience ?? "")} placeholder="제공할 사례 또는 해당 없는 사유" /></label>
      <fieldset><legend>제작 자료 준비 방식</legend>
        <p>칠판형은 구성안·촬영 진행표로 검토합니다. 형식이 바뀌어도 기존 자료는 삭제하지 않습니다. 촬영 후 파생 콘텐츠·발행키트를 만들 때는 ‘자막·영상 편집’에서 실제 촬영 자막을 저장해 주세요. 준비 자료는 실제 발화로 사용하지 않습니다.</p>
        <label>준비할 자료<select name="preparationKind" defaultValue={planMode ? "shooting_plan" : "full_script"}><option value="full_script">전문 원고 (칠판형 제외)</option><option value="shooting_plan">구성안·촬영 진행표</option></select></label>
        <label>내용 구성안<textarea name="design" rows={5} defaultValue={String(preparation.design ?? "")} placeholder="도입부의 약속 → 핵심 정보와 근거 → 해석 → 마무리" /></label>
        <label>촬영 진행표<textarea name="shootingPlan" rows={6} defaultValue={String(preparation.shootingPlan ?? "")} placeholder="설명 순서, 칠판 키워드·도식, 사례, 전환 지점. 실제 촬영 발화나 자막과는 별개입니다." /></label>
      </fieldset>
      <div className="form-grid"><label>보이스 MP3 URL<input type="url" name="voiceUrl" defaultValue={String(state.source.metadata.voiceUrl ?? "")} /></label><label>이미지 폴더 URL<input type="url" name="imageFolderUrl" defaultValue={String(state.source.metadata.imageFolderUrl ?? "")} /></label></div>
      <div className="form-grid"><label>캐릭터 자산 URL<input type="url" name="characterUrl" defaultValue={String(state.source.metadata.characterUrl ?? "")} /></label><label>편집 사양 URL<input type="url" name="editSpecUrl" defaultValue={String(state.source.metadata.editSpecUrl ?? "")} /></label></div>
      <label>최종 영상 URL<input type="url" pattern="https://.*" name="finalVideoUrl" defaultValue={String(state.source.metadata.finalVideoUrl ?? "")} placeholder="편집 완료 후 검토할 영상 주소" /></label>
      <button className="primary-button" disabled={busy}>{enabled ? "입력 자료 저장" : "자료 저장·공정 시작"}</button>
    </form>
    <section className="factory-route" aria-label="숏폼 팩토리 22단계"><header><strong>22단계 제작 경로</strong><span>라인 {String(state.source.metadata.productionLine ?? "A")} · 규칙 {String(state.source.metadata.rulesVersion ?? "v1")}</span></header><div>{FACTORY_PHASES.map((phase) => <article key={phase.title}><h3>{phase.title}</h3><ol>{phase.steps.map((step) => <li key={step}>{step}</li>)}</ol></article>)}</div><p>검토 1 · 기획·제목·썸네일, 검토 2 · 원고 또는 구성안·촬영 진행표, 검토 3 · 최종 영상. 관련 자료가 바뀌면 다시 검토합니다. 제작 자산은 형식에 맞게 준비합니다.</p></section>
    {pilotAvailable ? <section className="panel" aria-label="내 목소리 영상 자동화 준비"><h3>내 목소리 + 제작 화면</h3>
      <p>비공개 업로드용 제작 경로입니다. 기본 화면은 브랜디액션 캐릭터와 그려지는 도식입니다. JEV 파일럿 점수는 참고 정보이며 제작·업로드 승인으로 사용하지 않습니다.</p>
      {voicePlan?.missing.length ? <p>준비할 항목: {voicePlan.missing.join(" · ")}</p> : <p>현재 원고와 패키징 버전이 연결됐습니다. 음성은 첫 단락만 미리듣기할 수 있습니다.</p>}
      {!voicePreviewConfigured ? <p>Fish Audio 서버 설정이 필요합니다.</p> : null}
      {profile?.role === "admin" ? <button type="button" className="secondary-button" disabled={busy || !voicePlan?.inputKey || !voicePreviewConfigured} onClick={() => void previewVoice()}>내 목소리 첫 단락 미리듣기</button> : null}
      <button type="button" className="secondary-button" disabled={busy || !voicePlan?.inputKey} onClick={() => void generateScenes()}>Sol로 화면 설계 만들기</button>
      {voicePreviewUrl && voicePreviewKey === voicePlan?.inputKey ? <audio controls src={voicePreviewUrl} aria-label="내 목소리 생성 결과 미리듣기" /> : null}
      {currentScenePlan ? <details><summary>현재 원고의 화면 설계 {currentScenePlan.scenes?.length ?? 0}장면</summary><p>{currentScenePlan.visualDirection}</p><ol>{currentScenePlan.scenes?.map((scene) => <li key={scene.segmentIndex}><strong>{scene.segmentIndex + 1}. {scene.layoutTemplate} · {scene.visualType}</strong>{scene.characterAssetRole ? ` · 캐릭터: ${youtubeCharacterAssetRoleLabels[scene.characterAssetRole]}` : ""} · {scene.visualPrompt}{scene.visualBeats?.length ? ` · 멘트별 화면: ${scene.visualBeats.map((beat) => `${beat.spokenAnchor} → ${beat.visualAction}: ${beat.graphicSpec}${beat.displayText ? ` / ${beat.displayText}` : ""}`).join(" / ")}` : ""}{scene.onScreenText ? ` · 화면 문구: ${scene.onScreenText}` : ""}{scene.evidenceNote ? ` · 근거: ${scene.evidenceNote}` : ""}</li>)}</ol>{currentScenePlan.unresolved?.length ? <p>확인할 항목: {currentScenePlan.unresolved.join(" · ")}</p> : null}</details> : null}
      {profile?.role === "admin" && firstGeneratedScene ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void previewImage(firstGeneratedScene.segmentIndex)}>보조 실사 장면 미리보기</button> : null}
      {imagePreviewUrl && imagePreviewKey === voicePlan?.inputKey ? <img src={imagePreviewUrl} alt="AI로 만든 장면 미리보기" width={640} height={360} style={{ width: "100%", maxWidth: 640, height: "auto" }} /> : null}
      {profile?.role === "admin" && currentScenePlan && !currentScenePlan.unresolved?.length ? <button type="button" className="secondary-button" disabled={busy || !voicePreviewConfigured} onClick={() => void queueVoice()}>현재 원고 전체 음성 제작 작업 등록</button> : null}
      {voiceRuns.length ? <details open><summary>음성 제작 작업 {voiceRuns.length}건</summary>{voiceRuns.map((run) => <div key={run.id}><p>{run.status === "done" ? "음성 준비 완료" : run.status === "blocked" ? "확인 필요" : run.status === "in_progress" ? "제작 중" : "제작 대기"} · {run.segmentsReady}/{run.segmentCount}단락 · {run.stage}{run.lastErrorCode ? ` · ${run.lastErrorCode}` : ""}</p>{run.needsAttention.map((issue) => <p key={issue}>{issue}</p>)}{run.readyIndexes.map((index) => <button type="button" className="ghost-button" disabled={busy} key={index} onClick={() => void listenVoiceSegment(run.id, index)}>{index + 1}단락 듣기</button>)}</div>)}</details> : null}
      {voiceRunAudioUrl ? <audio key={voiceRunAudioUrl} controls src={voiceRunAudioUrl} aria-label="음성 제작 결과 듣기" /> : null}
      <p>음성 작업은 개발용 워커가 연결된 뒤 단락별로 진행됩니다. 화면 자산 전체 제작, 렌더링, 비공개 업로드는 아직 연결 전입니다.</p>
    </section> : null}
    <div className="pipeline-gates">{PIPELINE_GATES.map((title, index) => {
      const gate = index + 1; const prior = state.reviews.filter((review) => review.gate === gate).at(-1);
      return <article key={title}><header><strong>{gate}. {title}</strong><span className={`status-pill status-${state.approved[index] ? "ready" : "review"}`}>{state.approved[index] ? "승인 완료" : prior?.signature !== undefined && prior.signature !== state.signatures[index] ? "자료 변경 · 재검토" : prior && !prior.approved ? "수정 요청" : "검토 대기"}</span></header>
        <div className="pipeline-actions">{actions.filter((item) => item.gate === index).map((item) => <button className="secondary-button" key={item.action} disabled={busy || !enabled || state.approved.slice(0, item.gate).some((approved) => !approved)} onClick={() => void perform(async () => { const result = await generateContent(accessToken, { sourceId, action: item.action, count: 5 }); if (result.queued) throw new Error("Claude 연결이 필요합니다. 입력 자료와 작업 이력은 저장되어 있습니다."); })}>{item.label}</button>)}</div>
        {state.missing[index].length ? <p>보완할 자료: {state.missing[index].join(" · ")}</p> : null}
        <label>검토 메모<textarea rows={2} value={notes[gate] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [gate]: event.target.value }))} /></label>
        <div className="pipeline-actions"><button className="primary-button" disabled={busy || !enabled || state.approved[index] || state.missing[index].length > 0 || state.approved.slice(0, index).some((value) => !value)} onClick={() => void perform(() => apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ sourceId, gate, signature: state.signatures[index], approved: true, note: notes[gate] ?? "" }) }))}>검토한 자료 승인</button><button className="secondary-button" disabled={busy || !enabled || !notes[gate]?.trim()} onClick={() => void perform(() => apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ sourceId, gate, signature: state.signatures[index], approved: false, note: notes[gate] }) }))}>수정 요청</button></div>
        {prior ? <small>{new Date(prior.at).toLocaleString("ko-KR")} · {prior.note || "검토 기록 저장됨"}</small> : null}
      </article>;
    })}</div>
    <div className="pipeline-artifacts">{[artifacts.research, artifacts.packaging, artifacts.script, artifacts.kit].filter((item): item is OsRecord => !!item).map((item) => <details key={item.id}><summary>{item.title} · v{item.version}</summary><pre>{item.record_type === "content_script" ? item.description : JSON.stringify(item.metadata.result ?? item.description, null, 2)}</pre></details>)}</div>
    <nav className="pipeline-actions"><Link href={`/content/scripts?sourceId=${sourceId}`}>원고</Link><Link href={`/content/shorts?sourceId=${sourceId}`}>자막·영상 편집</Link><Link href={`/content/youtube?sourceId=${sourceId}`}>유튜브 업로드</Link><Link href="/content/performance">영상 성과</Link></nav>
    <p>영상 렌더링과 외부 채널 발행은 연결 상태와 최종 결과를 별도로 확인합니다. 승인만으로 영상이 생성되거나 발행되지는 않습니다.</p>
    <details><summary>실행 이력 {runs.length}건 · 검토 이력 {state.reviews.length}건</summary><p>검토 이력에는 승인과 수정 요청이 모두 포함됩니다.</p>{runs.toReversed().map((run) => <p key={`${run.key}-${run.at}`}>{ACTIONS.find((item) => item.action === run.action)?.label ?? run.action} · {({ running: "실행 중", succeeded: "완료", failed: "실패", needs_input: "입력 필요" })[run.state]} · {new Date(run.at).toLocaleString("ko-KR")}{run.error ? ` · ${run.error}` : ""}</p>)}{state.reviews.toReversed().map((review, index) => <p key={`${review.at}-${index}`}>{PIPELINE_GATES[review.gate - 1]} · {review.approved ? "승인" : "수정 요청"} · {new Date(review.at).toLocaleString("ko-KR")} · {review.note}</p>)}</details>
  </section>;
}

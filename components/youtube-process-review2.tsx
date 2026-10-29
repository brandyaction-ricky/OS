"use client";
import { useEffect, useRef, useState } from "react";
import { scriptKey, type YpOutline } from "@/lib/youtube-process/stages";
import { REVIEW2_GATE_NAME } from "@/lib/youtube-script-review2";
import { CostTag, tokenEstimate, useCostConfirm, useCostModels } from "./cost-notice";
import type { useYpBundle } from "./youtube-process-frame";

const WAIT_MS = 6 * 60_000;

/** 구성안 원고 칸: GPT's 두 번째 검수 (관문 2~6). It only informs; 다음: 제작 is not blocked by it. */
export function ScriptReview2({ page, outline, editable, dirty }: { page: ReturnType<typeof useYpBundle>; outline: YpOutline; editable: boolean; dirty: boolean }) {
  const review = page.bundle?.stages.review2;
  const cost = useCostConfirm(), { review: model } = useCostModels();
  const [busy, setBusy] = useState(false);
  const data = review?.data;
  // A staff AI's 원고 starts the judgement on the server; until it lands the card waits for it (it takes a few minutes).
  const fresh = Boolean(outline.ai && Date.parse(outline.ai.at) > Date.now() - WAIT_MS && (!data?.at || data.at < outline.ai.at));
  const waiting = busy || data?.state === "running" || fresh;
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; });
  const projectId = page.bundle?.project.id;
  useEffect(() => {
    if (!waiting || busy || !projectId) return;
    const timer = window.setInterval(() => {
      const current = pageRef.current;
      void current.client?.bundle(projectId).then(next => current.setBundle(bundle => bundle ? { ...bundle, stages: { ...bundle.stages, review2: next.stages.review2 } } : bundle), () => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [waiting, busy, projectId]);
  if (!review || !data) return null;
  const stale = data.state === "done" && data.key !== scriptKey(outline.script);
  const issues = data.gates.reduce((sum, gate) => sum + gate.items.filter(item => item.grade !== "하").length, 0);
  const run = async () => {
    if (!projectId || !page.client) return;
    const client = page.client;
    const ok = await cost.confirm({ model, amount: tokenEstimate(model, 40_000 + outline.script.length, 20_000), upTo: true, detail: "원고와 정본 두 편(검수 · 말투)을 함께 보내요",
      note: "GPT 크레딧(매달 500달러)에서 나가요.", ok: "검수하기" });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await client.review2(projectId);
      page.setBundle(bundle => bundle ? { ...bundle, stages: { ...bundle.stages, review2: next } } : bundle);
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  const label = data.state === "none" ? "GPT 검수 받기" : "다시 검수";
  const blocked = !editable ? "구성안이 닫혀 있어요" : dirty ? "저장된 뒤에 검수할 수 있어요" : waiting ? "검수하는 중이에요" : data.state === "done" && !stale ? "원고가 그대로예요" : "";
  return <section className="yp-card" style={{ marginTop: 8 }} aria-label="GPT 두 번째 검수">
    <div className="yp-card-h">
      <b style={{ fontSize: 13 }}>GPT 두 번째 검수</b>
      {waiting ? <span className="yp-tag">GPT가 읽는 중 · 3~4분</span>
        : data.state === "done" ? <span className={`yp-tag ${data.pass ? "yp-ok" : "yp-bad"}`}>{data.pass ? "✓ 통과" : `고칠 곳 ${issues}곳`}</span>
        : data.state === "failed" ? <span className="yp-tag yp-bad">⚠ 끝내지 못했어요</span> : <span className="yp-muted" style={{ fontSize: 12 }}>아직 받지 않았어요</span>}
      {stale && !waiting ? <span className="yp-muted" style={{ fontSize: 12 }}>원고가 바뀌었어요</span> : null}
      <span className="yp-sp" />
      {editable ? <button type="button" className="yp-btn yp-sm" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => void run()}>{label} <CostTag kind="paid" /></button> : null}
    </div>
    {data.state === "failed" && !waiting ? <div className="yp-card-b" style={{ fontSize: 13 }}>{data.error}</div> : null}
    {data.state === "done" ? <div className="yp-card-b" style={{ fontSize: 13, display: "grid", gap: 6 }}>
      {data.gates.filter(gate => gate.items.length).map(gate => <details key={gate.gate} open={!gate.pass}>
        <summary style={{ cursor: "pointer" }}><b>{REVIEW2_GATE_NAME[gate.gate]}</b> · {gate.pass ? "통과" : "반려"} · {gate.items.length}곳</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>{gate.items.map((item, i) => <li key={i}>
          <span className={`yp-tag${item.grade === "상" ? " yp-bad" : ""}`}>{item.paragraph}번 문단 · {item.grade}</span> “{item.quote}”
          <div>{item.reason}</div>{item.fix ? <div className="yp-muted">→ {item.fix}</div> : null}</li>)}</ul></details>)}
      {data.gates.some(gate => gate.pass && !gate.items.length) ? <div className="yp-muted">통과: {data.gates.filter(gate => gate.pass && !gate.items.length).map(gate => REVIEW2_GATE_NAME[gate.gate]).join(" · ")}</div> : null}
      {data.doubts.length ? <details><summary style={{ cursor: "pointer" }}>확인해 볼 것 {data.doubts.length}</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{data.doubts.map((doubt, i) => <li key={i}>{doubt}</li>)}</ul></details> : null}
      <div className="yp-hint">참고용이에요. 제작으로 넘어가는 건 막지 않아요.</div>
    </div> : null}
    {cost.element}
  </section>;
}

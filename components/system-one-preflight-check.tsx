"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSession } from "./session-provider";
import { checkPreflight } from "@/lib/system-one-preflight-client";
import { getBrowserSupabase } from "@/lib/supabase/client";

type TestDocument = { id: string; title: string; current_version: number };

export function SystemOnePreflightCheck() {
  const { accessToken, demo, loading, profile } = useSession();
  const [documents, setDocuments] = useState<TestDocument[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [criterionId, setCriterionId] = useState("");
  const [sourceVersion, setSourceVersion] = useState(1);
  const [criterionVersion, setCriterionVersion] = useState(1);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult("");
    setDocuments([]);
    setSourceId("");
    setCriterionId("");
    setBusy(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [accessToken]);

  async function loadTestDocuments() {
    if (busy || loading || demo || !accessToken || !profile) return;
    const client = getBrowserSupabase();
    if (!client) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setResult("");
    try {
      // User JWT + RLS, bounded to the approved test folder and current owner.
      const { data, error } = await client.from("os_documents")
        .select("id,title,current_version")
        .eq("folder", "개발 QA/공통 판단 레이어").eq("owner_id", profile.id)
        .neq("status", "archived").order("title").limit(50).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (error) throw new Error("read_failed");
      setDocuments(data ?? []);
      setResult(data?.length ? "시험 문서 목록을 불러왔습니다. 두 문서를 선택해 주세요." : "현재 계정의 시험 문서가 없습니다.");
    } catch {
      if (request.current === controller) setResult("시험 문서 목록을 불러오지 못했습니다.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || demo || !accessToken) return;
    const fields = new FormData(event.currentTarget);
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setResult("");
    try {
      const message = await checkPreflight(accessToken, {
        source: { id: String(fields.get("sourceId")).trim(), expectedVersion: Number(fields.get("sourceVersion")) },
        criteria: [{ id: String(fields.get("criterionId")).trim(), expectedVersion: Number(fields.get("criterionVersion")) }],
      }, controller.signal);
      if (!controller.signal.aborted) setResult(message);
    } catch {
      if (request.current === controller) setResult("요청이 중단되었거나 연결을 확인할 수 없습니다. 다시 시도해 주세요.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setBusy(false);
    }
  }

  return <div className="knowledge-workspace">
    <header className="page-heading"><div><span className="eyebrow">DEV 전용 · 기술 검수</span>
      <h1>문서 읽기·버전 확인</h1>
      <p>현재 로그인 계정으로 두 문서를 읽을 수 있는지 확인합니다. 내용의 옳고 그름을 판단하는 기능은 아닙니다.</p>
    </div></header>
    <section className="panel" style={{ padding: 24, maxWidth: 840 }}>
      <p>내 시험 문서를 불러와 두 문서를 선택하세요. 버전 값을 바꾸면 불일치 검사를 할 수 있습니다.</p>
      <p><Link href="/knowledge">DEV 문서함 열기</Link> · 자료 위치: 개발 QA/공통 판단 레이어</p>
      <button className="ghost-button" disabled={busy || loading || demo || !accessToken} onClick={loadTestDocuments}>내 시험 문서 불러오기</button>
      <form onSubmit={submit} onChange={() => setResult("")}>
        <fieldset disabled={busy || loading || demo || !accessToken} style={{ border: 0, padding: 0 }}>
          <div className="form-fields">
            <label><span>확인할 자료</span><select value={sourceId} onChange={event => { const id = event.target.value; setSourceId(id); setSourceVersion(documents.find(item => item.id === id)?.current_version ?? 1); }}><option value="">문서를 선택하세요</option>{documents.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.current_version}</option>)}</select></label>
            <label><span>자료 버전</span><input name="sourceVersion" type="number" min={1} max={2147483647} step={1} value={sourceVersion} onChange={event => setSourceVersion(Number(event.target.value))} required /></label>
            <label><span>기준 자료</span><select value={criterionId} onChange={event => { const id = event.target.value; setCriterionId(id); setCriterionVersion(documents.find(item => item.id === id)?.current_version ?? 1); }}><option value="">문서를 선택하세요</option>{documents.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.current_version}</option>)}</select></label>
            <label><span>기준 버전</span><input name="criterionVersion" type="number" min={1} max={2147483647} step={1} value={criterionVersion} onChange={event => setCriterionVersion(Number(event.target.value))} required /></label>
            <label><span>확인용 ID (자료)</span><input name="sourceId" required maxLength={36} value={sourceId} onChange={event => setSourceId(event.target.value)} /></label>
            <label><span>확인용 ID (기준)</span><input name="criterionId" required maxLength={36} value={criterionId} onChange={event => setCriterionId(event.target.value)} /></label>
          </div>
          <button className="primary-button" type="submit">{busy ? "확인 중…" : "읽기·버전 확인"}</button>
        </fieldset>
      </form>
      <p role="status" aria-live="polite">{result || (loading ? "로그인 확인 중…" : demo || !accessToken ? "실제 DEV 로그인이 필요합니다." : "확인할 자료를 입력해 주세요.")}</p>
      <p>읽기 전용입니다. 문서 수정·판정 저장·AI 호출·운영 배포는 실행하지 않습니다.</p>
    </section>
  </div>;
}

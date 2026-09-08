"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

export function ContentLinkedScripts() {
  const { accessToken } = useSession();
  const [sourceId, setSourceId] = useState(""); const [scripts, setScripts] = useState<OsRecord[]>([]);
  const [draft, setDraft] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { setSourceId(new URLSearchParams(window.location.search).get("sourceId") ?? ""); }, []);
  useEffect(() => {
    if (!sourceId || !accessToken) return;
    let active = true;
    apiRequest<{ records: OsRecord[] }>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken }).then(({ records }) => {
      if (!active) return;
      const linked = records.filter((record) => record.record_type === "content_script").sort((a, b) => b.created_at.localeCompare(a.created_at));
      setScripts(linked); setDraft(linked[0]?.description ?? "");
    }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [accessToken, sourceId]);
  const script = scripts[0];
  const save = async () => {
    if (!script || busy) return; setBusy(true); setError("");
    try { const { record } = await updateRecord(accessToken, { id: script.id, expectedVersion: script.version, description: draft, status: "review" }); setScripts((current) => [record, ...current.filter((item) => item.id !== record.id)]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "원고를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  if (!sourceId) return null;
  return <section className="panel pipeline-panel"><header><h2>연결된 제작 공정 원고</h2><Link href={`/content/automation?sourceId=${sourceId}`}>공정·승인 현황으로</Link></header>{error ? <p className="inline-alert danger">{error}</p> : null}{script ? <><strong>{script.title} · v{script.version}</strong><p>원고를 수정하면 공정 화면에서 해당 자료를 다시 승인해야 합니다.</p><textarea rows={18} aria-label="연결된 원고 본문" value={draft} onChange={(event) => setDraft(event.target.value)} /><button className="primary-button" disabled={busy || !draft.trim()} onClick={save}>원고 저장</button></> : <p>연결된 원고가 없습니다. 제작 공정에서 소재 승인 후 원고를 생성해 주세요.</p>}</section>;
}

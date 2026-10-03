"use client";
import { useEffect, useState } from "react";
import { createRecord, listAllRecordsOfType, updateRecord } from "@/lib/api-client";
import { defaultGenerationMode, generationSetting, GENERATION_SETTING_KEY, type GenerationMode } from "@/lib/content-generation-mode";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

export function ContentGenerationSettings() {
  const { accessToken, demo } = useSession();
  const [record, setRecord] = useState<OsRecord>();
  const [mode, setMode] = useState<GenerationMode>("queue");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    if (demo) { setLoading(false); return; }
    listAllRecordsOfType(accessToken, "company_setting").then(records => {
      if (active) { setRecord(generationSetting(records)); setMode(defaultGenerationMode(records)); setLoading(false); }
    }).catch(() => { if (active) setNotice("기본 생성 방식을 읽지 못했습니다. 화면을 다시 열어 주세요."); });
    return () => { active = false; };
  }, [accessToken, demo]);
  async function save() {
    if (demo) { setNotice("데모에서는 저장하지 않습니다."); return; }
    setBusy(true); setNotice("");
    const metadata = { ...record?.metadata, settingKey: GENERATION_SETTING_KEY, defaultGenerationMode: mode };
    try {
      const result = record ? await updateRecord(accessToken, { id: record.id, expectedVersion: record.version, metadata }) : await createRecord(accessToken, { recordType: "company_setting", title: "기본 생성 방식", status: "active", metadata, tags: [GENERATION_SETTING_KEY] });
      setRecord(result.record); setNotice("기본 생성 방식을 저장했습니다. 기존 대기 작업은 바꾸지 않습니다.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="panel generation-settings"><h2>기본 생성 방식</h2><p>구독 대기열이 기본입니다. API를 고르면 생성 버튼이 ‘바로 받기’로 표시되며, 누를 때만 비용이 발생합니다. 설정 변경만으로는 실행되지 않습니다.</p><label>생성 방식<select value={mode} disabled={loading || busy} onChange={event => setMode(event.target.value as GenerationMode)}><option value="queue">구독 대기열 · 기본</option><option value="api">바로 받기 · API</option></select></label><button type="button" className="primary-button" disabled={loading || busy} onClick={save}>저장</button>{notice ? <p role="status">{notice}</p> : null}</section>;
}

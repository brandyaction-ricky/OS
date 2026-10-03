"use client";

import { useEffect, useState } from "react";
import { createRecord, listAllRecordsOfType, updateRecord } from "@/lib/api-client";
import { MEETING_TERMS } from "@/lib/meeting-review";
import { customMeetingTerms, MEETING_TERM_SETTING_KEY, meetingTermSetting, type MeetingTerm } from "@/lib/meeting-term-settings";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

export function MeetingTermSettings() {
  const { accessToken, demo } = useSession();
  const [record, setRecord] = useState<OsRecord>();
  const [terms, setTerms] = useState<MeetingTerm[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (demo) return;
    let active = true;
    listAllRecordsOfType(accessToken, "company_setting").then(records => {
      if (!active) return;
      setRecord(meetingTermSetting(records)); setTerms(customMeetingTerms(records)); setNotice("");
    }).catch(() => { if (active) setNotice("회의 용어 사전을 읽지 못했습니다. 다시 열어 주세요."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, demo]);

  const change = (index: number, field: keyof MeetingTerm, value: string) =>
    setTerms(current => current.map((term, at) => at === index ? { ...term, [field]: value } : term));
  const save = async () => {
    if (demo) { setNotice("데모에서는 저장하지 않습니다."); return; }
    const clean = terms.map(term => ({ from: term.from.trim(), to: term.to.trim() }));
    if (clean.some(term => !term.from || !term.to || term.from.length > 40 || term.to.length > 40
      || MEETING_TERMS.some(defaultTerm => defaultTerm.from === term.from))
      || new Set(clean.map(term => term.from.toLocaleLowerCase("ko-KR"))).size !== clean.length) {
      setNotice("용어를 40자 이내로 입력하고 중복을 없애 주세요. 기본 용어는 변경할 수 없습니다."); return;
    }
    setBusy(true); setNotice("");
    try {
      const metadata = { ...record?.metadata, settingKey: MEETING_TERM_SETTING_KEY, terms: clean };
      const result = record
        ? await updateRecord(accessToken, { id: record.id, expectedVersion: record.version, metadata })
        : await createRecord(accessToken, { recordType: "company_setting", title: "회의 용어 사전", status: "active", metadata, tags: [MEETING_TERM_SETTING_KEY] });
      setRecord(result.record); setNotice("용어 사전을 저장했습니다. 이후 추출하는 회의부터 적용됩니다.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "용어 사전을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <section className="panel meeting-term-settings"><h2>회의 용어 사전</h2><p>회의 요약·추출 문구를 검수할 때 적용합니다. 원본 전사와 기존 회의는 변경하지 않습니다.</p><p>기본값: {MEETING_TERMS.map(term => `${term.from} → ${term.to}`).join(" · ")}</p>
    {terms.map((term, index) => <div className="meeting-term-row" key={index}><label>원래 용어<input aria-label={`원래 용어 ${index + 1}`} maxLength={40} value={term.from} disabled={loading || busy} onChange={event => change(index, "from", event.target.value)} /></label><span aria-hidden="true">→</span><label>바꿀 용어<input aria-label={`바꿀 용어 ${index + 1}`} maxLength={40} value={term.to} disabled={loading || busy} onChange={event => change(index, "to", event.target.value)} /></label><button type="button" className="ghost-button" aria-label={`${index + 1}번 용어 삭제`} disabled={loading || busy} onClick={() => setTerms(current => current.filter((_, at) => at !== index))}>삭제</button></div>)}
    <div className="meeting-term-actions"><button type="button" className="secondary-button" disabled={loading || busy || terms.length >= 50} onClick={() => setTerms(current => [...current, { from: "", to: "" }])}>용어 추가</button><button type="button" className="primary-button" disabled={loading || busy} onClick={() => void save()}>{busy ? "저장 중…" : "저장"}</button></div>{notice ? <p role="status">{notice}</p> : null}</section>;
}

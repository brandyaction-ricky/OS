import Link from "next/link";
import { packagingEvidence } from "@/lib/content-packaging-evidence";
import { readPlanningHandoff } from "@/lib/content-planning-handoff";
import type { OsRecord } from "@/lib/record-types";

export function ContentPackagingEvidence({ source, records }: { source: OsRecord; records: OsRecord[] }) {
  const evidence = packagingEvidence(source.id, records, readPlanningHandoff(source.metadata.planningHandoff)?.thumbnailCopy);
  const labels = { missing: "선택 표시 없음", single: "1개에 선택 표시 있음", multiple: "여러 개 선택됨 — 하나로 확정됐는지 확인 필요", invalid: "저장 형식 확인 필요" };
  return <section className="panel" aria-label="연결된 제목·썸네일 선택">
    <div className="panel-header"><div><h3>연결된 제목·썸네일 선택</h3><p>같은 주제의 최신 패키징 기록{evidence.package ? ` · v${evidence.package.version}` : ""} · 읽기 전용</p></div></div>
    {evidence.status === "missing" ? <p>아직 연결된 패키징 산출물이 없습니다. 기획 메모의 카피를 확정 결과로 대신하지 않습니다.</p> : evidence.status !== "loaded" ? <p role="alert">최신 패키징 기록을 명확히 읽을 수 없습니다. 이전 기록으로 대신하지 않습니다.</p> : <dl className="planning-facts">{(["titles", "copies"] as const).map(key => <div key={key}><dt>{key === "titles" ? "제목" : "썸네일 카피"} · {labels[evidence[key].state]}</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{evidence[key].texts.join("\n") || "확인할 선택이 없습니다."}</dd></div>)}</dl>}
    {evidence.copyDiffers ? <p className="inline-alert warning">선택된 썸네일 카피와 기획 인계 메모가 다릅니다. 어느 내용을 사용할지 확인해 주세요. 자동으로 덮어쓰지 않습니다.</p> : null}
    <p>별표 선택은 대표 승인 증거가 아닙니다. 대표 승인·시안/콘티·정본 기준 검증은 아직 연결되지 않았으며, 집필 준비 완료로 판정하지 않습니다.</p>
    <div className="drawer-actions"><Link className="secondary-button" href={`/content/packages?sourceId=${encodeURIComponent(source.id)}`}>패키징 선택 확인하러 가기</Link></div>
  </section>;
}

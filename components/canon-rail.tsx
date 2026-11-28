import Link from "next/link";
import styles from "./canon-rail.module.css";
import type { CanonTrace } from "@/lib/youtube-process/canon-trace";

export function CanonRail({ refs, legacy, check, pending = false }: { refs?: CanonTrace[]; legacy?: string; check?: string; pending?: boolean }) {
  return <section className={styles.rail} aria-label="생성에 적용한 정본">
    <strong>적용 정본</strong>
    {refs?.length ? refs.map(ref => <Link key={ref.id} className="yp-tag" href={`/knowledge/doc/${ref.id}`}>{ref.title} · 문서 v{ref.version}</Link>)
      : pending ? <span>생성 후 문서와 버전을 확인할 수 있어요.</span> : <span className="yp-tag yp-warn">문서 버전 기록 없음{legacy ? ` · 작성 시 표기 ${legacy}` : ""}</span>}
    {!refs?.length && !pending && <Link href="/content/canon">제작 정본 현황</Link>}
    {check && <span className={styles.check}>{check}</span>}
  </section>;
}

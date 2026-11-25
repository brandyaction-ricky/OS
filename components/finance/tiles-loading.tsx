import { NumberLoading } from "@/components/workspace-load-state";

/** 재무 화면을 불러오는 동안 (2026-11-25): the tile row with grey rolling digits where the amounts will appear. */
export function FinanceTilesLoading({ label }: { label: string }) {
  return <div className="finance-workspace" role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="fin-tiles fin-t4" aria-hidden="true">{[0, 1, 2, 3].map((key) =>
      <div className="fin-tile" key={key}><span className="fin-l">{key ? " " : label}</span><span className="fin-v"><NumberLoading digits={6} /></span></div>)}</div>
  </div>;
}

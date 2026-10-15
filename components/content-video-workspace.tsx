"use client";
import { useContentWork } from "./content-work-provider";
import { PageTitle } from "./page-title";
import { YoutubeProductionSteps } from "./youtube-production-steps";

/** ③ 영상 제작: the narrated mind-map video for the video picked in the process bar above. */
export function ContentVideoWorkspace() {
  const work = useContentWork();
  const selected = work?.selected;
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>승인된 원고로 대표 목소리 내레이션과 마인드맵 영상을 만듭니다. 직접 촬영하는 영상은 이 단계를 건너뜁니다.</p></div></header>
    {work?.loading ? <section className="panel load-error" role="status">작업 영상 불러오는 중…</section>
      : work?.error ? <section className="panel load-error" role="alert">{work.error}</section>
        : !selected ? <section className="panel empty-state"><div><h3>영상을 먼저 골라 주세요</h3><p>위 ‘작업 중인 영상’에서 원고 승인까지 마친 영상을 고르면 제작 단계가 열립니다.</p></div></section>
          : <YoutubeProductionSteps key={selected.id} sourceId={selected.id} storedPlan={selected.metadata.narratedScenePlan} onChange={async () => work.reload()} />}
  </>;
}

"use client";
import { useState } from "react";
import { useContentWork } from "./content-work-provider";
import { MyinV13Panel } from "./myin-v13-panel";
import { PageTitle } from "./page-title";
import { YoutubeProductionSteps } from "./youtube-production-steps";

/**
 * ③ 영상 제작 for the video picked in the process bar above: the 마이인 v13 steps (owner decision 2026-10-19: the default for
 * every new video; the mind-map format retires). A video made the old way keeps its mind-map steps behind one click.
 */
export function ContentVideoWorkspace() {
  const work = useContentWork();
  const selected = work?.selected;
  const [legacyFor, setLegacyFor] = useState("");
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>승인된 원고로 대표 목소리와 마이인 형식 영상(타이포그래피·비유 도식)을 만듭니다. 직접 촬영하는 영상은 이 단계를 건너뜁니다.</p></div></header>
    {work?.loading ? <section className="panel load-error" role="status">작업 영상 불러오는 중…</section>
      : work?.error ? <section className="panel load-error" role="alert">{work.error}</section>
        : !selected ? <section className="panel empty-state"><div><h3>영상을 먼저 골라 주세요</h3><p>위 ‘작업 중인 영상’에서 원고 승인까지 마친 영상을 고르면 제작 단계가 열립니다.</p></div></section>
          : <>
            <MyinV13Panel key={`myin-${selected.id}`} sourceId={selected.id} />
            {selected.metadata.narratedScenePlan ? <details key={`legacy-${selected.id}`} className="panel" onToggle={(event) => setLegacyFor(event.currentTarget.open ? selected.id : "")}>
              <summary>이전 방식(마인드맵)으로 만든 결과 보기</summary>
              <p>새 영상은 위 마이인 형식으로 만듭니다. 이 칸은 예전에 마인드맵으로 만든 영상을 다시 볼 때만 씁니다.</p>
              {legacyFor === selected.id ? <YoutubeProductionSteps sourceId={selected.id} storedPlan={selected.metadata.narratedScenePlan} onChange={async () => work.reload()} /> : null}
            </details> : null}
          </>}
  </>;
}

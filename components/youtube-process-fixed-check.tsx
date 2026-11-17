"use client";
import { useEffect, useState } from "react";
import { alignVersions, srtCues, type Anchor } from "@/lib/youtube-process/compare";
import { fixedInVersion, fixedSpot } from "@/lib/youtube-process/fixed-check";
import type { FeedbackAction } from "@/lib/youtube-process/feedback";
import type { YpFeedbackView, YpFinalView } from "./youtube-process-data";

const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** 이번 수정 확인 (유쓰 요청 d06d8afe): beside the version being watched, the earlier comments it fixed — go to each fixed spot, compare with the old version, then 반영 확인 or 다시 수정. */
export function FixedCheck({ items, ver, finals, finalSrt, duration, onSeek, onCompare, act }: {
  items: YpFeedbackView[]; ver: number; finals: YpFinalView[]; finalSrt?: (final: YpFinalView) => Promise<string | null>; duration: number;
  onSeek: (seconds: number) => void; onCompare: (oldVer: number, at: number) => void;
  act: (item: YpFeedbackView, action: FeedbackAction) => Promise<string>;
}) {
  const fixed = fixedInVersion(items, ver);
  const olds = [...new Set(fixed.map(item => item.ver))];
  const oldKey = olds.join(",");
  const [anchors, setAnchors] = useState<Record<number, Anchor[] | null>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const now = finals.find(row => row.v === ver);
    if (!finalSrt || !now || !oldKey) return;
    void (async () => {
      const mine = await finalSrt(now).catch(() => null);
      const next: Record<number, Anchor[] | null> = {};
      for (const v of oldKey.split(",").map(Number)) {
        const old = finals.find(row => row.v === v);
        const srt = old && mine ? await finalSrt(old).catch(() => null) : null;
        next[v] = srt && mine ? alignVersions(srtCues(srt), srtCues(mine)).anchors : null;
      }
      if (live) setAnchors(next);
    })();
    return () => { live = false; };
  }, [finalSrt, finals, ver, oldKey]);
  if (!fixed.length) return null;
  const spot = (item: YpFeedbackView) => fixedSpot(item.t ?? item.range?.[0] ?? 0, anchors[item.ver], duration);
  const checked = fixed.filter(item => item.confirmedBy).length;
  const decide = async (item: YpFeedbackView, action: "confirm" | "reopen") => {
    setBusy(true);
    const error = await act(item, action);
    setBusy(false);
    setErrors(map => ({ ...map, [item.id]: error }));
    if (error) return;
    // The next one still waiting for a look, played from its fixed spot.
    const next = fixed.find(row => row.id !== item.id && !row.confirmedBy && fixed.indexOf(row) > fixed.indexOf(item)) ?? fixed.find(row => row.id !== item.id && !row.confirmedBy);
    if (next) { setCurrent(next.id); onSeek(spot(next).at); }
  };
  return <details className="yp-notices yp-fixcheck" open aria-label="이번 수정 확인">
    <summary><b>이번 수정 확인</b> · v{ver}에서 고친 의견 {fixed.length}개 · 확인 {checked}개</summary>
    <ol className="yp-fixlist">
      {fixed.map(item => {
        const place = spot(item), at = item.t ?? item.range?.[0] ?? 0;
        return <li key={item.id} id={`fix-${item.id}`} className="yp-fixrow" data-current={current === item.id || undefined}>
          <div className="yp-fixhead">
            <button type="button" className="yp-lnk" onClick={() => { setCurrent(item.id); onSeek(place.at); }}>v{ver} {fmt(place.at)}에서 보기</button>
            {place.sure ? null : <span className="yp-tag yp-warn" title="두 버전 자막에서 같은 문장을 찾지 못해 원래 시각으로 가요">위치 확인 필요</span>}
            <span className="yp-muted yp-fixsmall">원래 v{item.ver} {fmt(at)} · {item.who}</span>
          </div>
          <p className="yp-fixtext">{item.deleted ? "삭제된 의견" : item.text}</p>
          <div className="yp-fixhead">
            <button type="button" className="yp-btn yp-sm" onClick={() => { setCurrent(item.id); onCompare(item.ver, place.at); }}>v{item.ver}와 비교</button>
            {item.confirmedBy ? <span className="yp-muted" role="status">반영 확인함 · {item.confirmedBy}</span>
              : <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy} onClick={() => void decide(item, "confirm")}>반영 확인</button>}
            <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => void decide(item, "reopen")}>다시 수정</button>
          </div>
          {errors[item.id] ? <p role="alert" className="yp-fixsmall">{errors[item.id]}</p> : null}
        </li>;
      })}
    </ol>
  </details>;
}

"use client";
import Link from "next/link";
import { Fragment, useSyncExternalStore, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Clock, Folder } from "lucide-react";
import { flowOf, projectName, stepHref, YP_FLOW, YP_STAGE_INDEX, type YpProject } from "@/lib/youtube-process/project";

/** The one 'what to do now' control at the right of the progress line (지시서 4-1 표). */
export type YpAction =
  | { kind: "button"; label: string; onClick: () => void; reason?: string; busy?: boolean; /** Shown before the button at the end of the step only. */ extra?: ReactNode; notice?: ReactNode }
  | { kind: "status"; status: string; secondary?: { label: string; onClick: () => void } }
  | { kind: "link"; label: string; href: string };

/** S0 진행 줄: project, its steps (past ones ✓; a 숏폼 has four), the step on screen, and the action. */
const mobileQuery = "(max-width: 700px)";
function watchMobile(listener: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function YoutubeFlow({ project, view, action: mainAction, mobileAction }: { project: YpProject; view: number; action: YpAction; mobileAction?: YpAction }) {
  const mobile = useSyncExternalStore(watchMobile, () => window.matchMedia(mobileQuery).matches, () => false);
  const action = mobile && mobileAction ? mobileAction : mainAction;
  const current = project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage];
  const [open, setOpen] = useState(false);
  const ad = project.yp.topic.purpose === "ad" && project.yp.topic.type === "short";
  const [productOpen,setProductOpen] = useState(false);
  const setup = project.yp.adSetup;
  const name = projectName(project);
  const flow = flowOf(project.yp.topic.type);
  const shown = flow.find(step => step.index === view) ?? flow[0];
  const card = project.yp.topic.type === "card";
  return <>{ad && <nav aria-label="광고 경로"><Link href="/content/projects?platform=ad">광고 › 내 광고</Link> › 영상 › {productOpen?"상품":shown.name}</nav>}<div className={`yp-flow${card ? " yp-card-flow" : ""}`}>
    <Link className="yp-fl-proj" href={ad ? "/content/projects?platform=ad" : card ? "/content/projects?platform=card" : "/content/projects"} title={ad ? "내 광고로" : card ? "내 카드뉴스로" : "내 영상으로"}><Folder size={15} className="yp-i" aria-hidden="true" /><span>{name}</span></Link>
    <ol className="yp-fl-steps" aria-label="공정 흐름">
      {ad && <li><button type="button" className="yp-fs yp-done" aria-expanded={productOpen} onClick={()=>setProductOpen(!productOpen)}>✓ 상품</button></li>}
      {flow.map(({ index, name: step }, at) => {
        const state = index < current ? "yp-done" : index === current ? "yp-now" : "";
        const mark = <span className="yp-d" aria-hidden="true">{card ? at + 1 : index < current ? "✓" : ""}</span>;
        const cls = `yp-fs ${state}${index === view ? " yp-view" : ""}`;
        return <Fragment key={step}>
          {at ? <li className="yp-fl-sep" aria-hidden="true"><ChevronRight size={12} /></li> : null}
          <li>{index <= current
            ? <Link className={cls} href={stepHref(index, project.id)} aria-current={index === view ? "step" : undefined}>{mark}{step}{card && index < current ? <small className="yp-step-done">완료</small> : null}</Link>
            // 로건 QA 10/30: a step not reached did nothing when pressed — it opens the step, which says why it is closed.
            : ad ? <span className={`${cls} yp-lock`} aria-disabled="true" title="앞 단계를 끝내면 열려요">{mark}{step}</span> : <Link className={`${cls} yp-lock`} href={stepHref(index, project.id)} aria-current={index === view ? "step" : undefined} title="아직 열리지 않았어요 · 눌러서 언제 열리는지 봐요">{mark}{step}</Link>}</li>
        </Fragment>;
      })}
    </ol>
    <button type="button" className="yp-fl-m" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {shown.name} ({flow.indexOf(shown) + (ad?2:1)}/{flow.length+(ad?1:0)}) <ChevronDown size={16} aria-hidden="true" /><span className="yp-nm">단계 모두 보기</span>
    </button>
    {open ? <div className="yp-pop" role="menu">{ad && <button type="button" className="yp-pop-i" onClick={()=>{setProductOpen(!productOpen);setOpen(false);}}>1. 상품</button>}{flow.map(({ index, name: step }, at) => index <= current
      ? <Link key={step} role="menuitem" className={`yp-pop-i${index === view ? " yp-on" : ""}`} href={stepHref(index, project.id)} onClick={() => setOpen(false)}>{at+(ad?2:1)}. {step}<small>{index < current ? "✓ 끝남" : "지금"}</small></Link>
      : ad ? <span key={step} role="menuitem" aria-disabled="true" className="yp-pop-i yp-lock">{at+2}. {step}<small>앞 단계 완료 후</small></span> : <Link key={step} role="menuitem" className={`yp-pop-i yp-lock${index === view ? " yp-on" : ""}`} href={stepHref(index, project.id)} onClick={() => setOpen(false)}>{at+(ad?2:1)}. {step}<small>아직</small></Link>)}</div> : null}
    <div className="yp-fl-act">
      {action.kind === "status" ? <>
        <span className="yp-fl-status"><Clock size={15} className="yp-i" aria-hidden="true" />{action.status}</span>
        {action.secondary ? <button type="button" className="yp-fl-sec" onClick={action.secondary.onClick}>{action.secondary.label}</button> : null}
      </> : action.kind === "link"
        ? <Link className="yp-btn yp-pri yp-lg" href={action.href}>{action.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        : <>
          {action.notice}
          {action.reason ? <span className="yp-fl-hint" id="yp-fl-hint">{action.reason}</span> : null}
          <button type="button" className="yp-btn yp-pri yp-lg" disabled={Boolean(action.reason) || action.busy} aria-describedby={action.reason ? "yp-fl-hint" : undefined} title={action.reason || undefined} onClick={action.onClick}>
            {action.busy ? "처리 중…" : action.label}<ArrowRight size={16} aria-hidden="true" />
          </button>
        </>}
    </div>
  </div>{ad && <details className="ic-details" open={productOpen} onToggle={e=>setProductOpen(e.currentTarget.open)}><summary>상품 · 광고 근거</summary><p>{setup?.product || "상품 정보는 기존 광고 브리프에서 확인하세요."}</p>
    {setup && <><p>확인한 근거 · {setup.evidence}</p><p>행동 · {setup.goal}</p></>}<p>광고 규칙 · 운영 정본 / 광고 전용 정본 · 문서 없음</p></details>}</>;
}

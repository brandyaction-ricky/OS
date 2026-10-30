"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Clock, Folder } from "lucide-react";
import { flowOf, projectName, stepHref, YP_FLOW, YP_STAGE_INDEX, type YpProject } from "@/lib/youtube-process/project";

/** The one 'what to do now' control at the right of the progress line (지시서 4-1 표). */
export type YpAction =
  | { kind: "button"; label: string; onClick: () => void; reason?: string; busy?: boolean }
  | { kind: "status"; status: string; secondary?: { label: string; onClick: () => void } }
  | { kind: "link"; label: string; href: string };

/** S0 진행 줄: project, its steps (past ones ✓; a 숏폼 has four), the step on screen, and the action. */
export function YoutubeFlow({ project, view, action }: { project: YpProject; view: number; action: YpAction }) {
  const current = project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage];
  const [open, setOpen] = useState(false);
  const name = projectName(project);
  const flow = flowOf(project.yp.topic.type);
  const shown = flow.find(step => step.index === view) ?? flow[0];
  const card = project.yp.topic.type === "card";
  return <div className={`yp-flow${card ? " yp-card-flow" : ""}`}>
    <Link className="yp-fl-proj" href="/content/projects" title="내 영상으로"><Folder size={15} className="yp-i" aria-hidden="true" /><span>{name}</span></Link>
    <ol className="yp-fl-steps" aria-label="공정 흐름">
      {flow.map(({ index, name: step }, at) => {
        const state = index < current ? "yp-done" : index === current ? "yp-now" : "";
        const mark = <span className="yp-d" aria-hidden="true">{card ? at + 1 : index < current ? "✓" : ""}</span>;
        const cls = `yp-fs ${state}${index === view ? " yp-view" : ""}`;
        return <Fragment key={step}>
          {at ? <li className="yp-fl-sep" aria-hidden="true"><ChevronRight size={12} /></li> : null}
          <li>{index <= current
            ? <Link className={cls} href={stepHref(index, project.id)} aria-current={index === view ? "step" : undefined}>{mark}{step}{card && index < current ? <small className="yp-step-done">완료</small> : null}</Link>
            : <button type="button" className={cls} disabled title="아직 열리지 않았어요">{mark}{step}</button>}</li>
        </Fragment>;
      })}
    </ol>
    <button type="button" className="yp-fl-m" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {shown.name} ({flow.indexOf(shown) + 1}/{flow.length}) <ChevronDown size={16} aria-hidden="true" /><span className="yp-nm">단계 모두 보기</span>
    </button>
    {open ? <div className="yp-pop" role="menu">{flow.map(({ index, name: step }, at) => index <= current
      ? <Link key={step} role="menuitem" className={`yp-pop-i${index === view ? " yp-on" : ""}`} href={stepHref(index, project.id)} onClick={() => setOpen(false)}>{at + 1}. {step}<small>{index < current ? "✓ 끝남" : "지금"}</small></Link>
      : <button key={step} type="button" role="menuitem" className="yp-pop-i" disabled>{at + 1}. {step}<small>아직</small></button>)}</div> : null}
    <div className="yp-fl-act">
      {action.kind === "status" ? <>
        <span className="yp-fl-status"><Clock size={15} className="yp-i" aria-hidden="true" />{action.status}</span>
        {action.secondary ? <button type="button" className="yp-fl-sec" onClick={action.secondary.onClick}>{action.secondary.label}</button> : null}
      </> : action.kind === "link"
        ? <Link className="yp-btn yp-pri yp-lg" href={action.href}>{action.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        : <>
          {action.reason ? <span className="yp-fl-hint" id="yp-fl-hint">{action.reason}</span> : null}
          <button type="button" className="yp-btn yp-pri yp-lg" disabled={Boolean(action.reason) || action.busy} aria-describedby={action.reason ? "yp-fl-hint" : undefined} title={action.reason || undefined} onClick={action.onClick}>
            {action.busy ? "처리 중…" : action.label}<ArrowRight size={16} aria-hidden="true" />
          </button>
        </>}
    </div>
  </div>;
}

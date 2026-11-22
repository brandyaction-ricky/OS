"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { campaignTrackingUrl } from "@/lib/ad-campaign";
import type { ImageBrief } from "@/lib/image-creative/model";
import { projectName, type YpProject } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { youtubeProcessClient } from "./youtube-process-data";

export function CampaignBriefPicker({brief,setBrief,locked}:{brief:ImageBrief;setBrief:(next:ImageBrief)=>void;locked:boolean}) {
  const {demo,accessToken} = useSession();
  const initialId = useSearchParams().get("campaign");
  const [choices,setChoices] = useState<YpProject[]>();
  const [choice,setSelected] = useState(brief.campaignId ?? initialId ?? "");
  const selected = locked ? brief.campaignId ?? "" : choice;
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [tracking,setTracking] = useState("");
  async function load(apply:boolean) {
    const client = youtubeProcessClient(accessToken,demo);
    if (!client) return;
    setBusy(true); setError("");
    try {
      const projects = (await client.list()).filter(row=>row.yp.topic.purpose==="ad");
      setChoices(projects);
      if (!apply) return;
      const campaign = projects.find(row=>row.id===selected);
      if (!campaign) throw new Error("이 계정에서 열 수 있는 광고 캠페인을 선택해 주세요.");
      const source = (await client.short(campaign.id)).brief;
      setTracking(campaignTrackingUrl(source.landingUrl,campaign.id,"image"));
      if (!locked) setBrief({...brief,campaignId:campaign.id,productSource:undefined,
        product:source.product.slice(0,2000),audience:source.audience.slice(0,2000),offer:source.appeal.slice(0,2000),
        objective:source.goal.slice(0,2000),facts:source.evidence,
        hypothesis:source.hypothesis,successCriterion:source.successCriterion,budget:source.budget});
    } catch (issue) {setError(issue instanceof Error ? issue.message : "광고 브리프를 불러오지 못했어요.");}
    finally {setBusy(false);}
  }
  return <details className="ic-details" open={initialId || brief.campaignId ? true : undefined}><summary>영상과 같은 캠페인 브리프 사용</summary>
    {brief.campaignId && <p><Link href={`/content/plan?project=${encodeURIComponent(brief.campaignId)}&view=draft`}>연결된 광고 브리프 열기 →</Link></p>}
    {!locked && <div className="ic-row"><button type="button" disabled={busy} className="secondary-button" onClick={()=>void load(false)}>캠페인 목록</button>
      {choices && <select className="field" value={selected} aria-label="광고 캠페인" onChange={e=>{setSelected(e.target.value);setTracking("");}}>
        <option value="">{choices.length?"캠페인 선택":"연결할 영상 광고가 없습니다"}</option>{choices.map(row=><option key={row.id} value={row.id}>{projectName(row)}</option>)}</select>}</div>}
    {selected && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(true)}>{locked?"이미지 광고 추적 주소 보기":"캠페인 브리프 불러오기"}</button>}
    {brief.campaignId && <dl className="ic-copy-lines"><dt>가설</dt><dd>{brief.hypothesis || "미입력"}</dd><dt>성과 기준</dt><dd>{brief.successCriterion || "미입력"}</dd><dt>예산</dt><dd>{brief.budget || "미입력"}</dd></dl>}
    {tracking && <label className="ic-field">이미지 광고 추적 주소<input className="field" value={tracking} readOnly onFocus={e=>e.currentTarget.select()}/></label>}
    {error && <p role="alert">{error}</p>}</details>;
}

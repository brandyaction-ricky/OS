"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
export function PublishingTabs({view}:{view:"create"|"review"|"calendar"}) {
  const search=useSearchParams();
  return <nav className="studio-tabs hub-tabs publishing-workspace-tabs" aria-label="발행·업로드 보기">{[["create","파생 콘텐츠 · 자동화","/automation/review"],["review","유튜브 발행·업로드","/content/publishing"],["calendar","유튜브 일정","/content/calendar"]].map(([key,label,path])=>{
    const query=new URLSearchParams(search.toString());query.delete("tab");
    if(key==="create")query.set("tab","create");
    return <Link key={key} href={`${path}${query.size ? `?${query}` : ""}`} className={key===view?"active":""} aria-current={key===view?"page":undefined}>{label}</Link>;
  })}</nav>;
}

"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
export function PublishingTabs({view}:{view:"create"|"review"|"calendar"}) {
  const search=useSearchParams();
  return <nav className="studio-tabs hub-tabs publishing-workspace-tabs" aria-label="발행·업로드 보기">{[["create","파생 만들기","/content/automation"],["review","검토·발행 대기","/content/publishing"],["calendar","발행 캘린더","/content/calendar"]].map(([key,label,path])=>{
    const query=new URLSearchParams(search.toString());query.delete("tab");
    return <Link key={key} href={`${path}${query.size ? `?${query}` : ""}`} className={key===view?"active":""} aria-current={key===view?"page":undefined}>{label}</Link>;
  })}</nav>;
}

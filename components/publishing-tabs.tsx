"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
export function PublishingTabs({view}:{view:"create"|"review"|"calendar"}) {
  const search=useSearchParams();
  return <nav className="studio-tabs hub-tabs" aria-label="발행·업로드 보기">{[["create","파생 만들기"],["review","검토·발행 대기"],["calendar","발행 캘린더"]].map(([key,label])=>{
    const query=new URLSearchParams(search.toString());query.set("tab",key);
    return <Link key={key} href={`/content/publishing?${query}`} className={key===view?"active":""} aria-current={key===view?"page":undefined}>{label}</Link>;
  })}</nav>;
}

"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {usePathname,useSearchParams} from "next/navigation";
import {CircleHelp,X} from "lucide-react";
import {findPage} from "@/lib/navigation";
import {PAGE_GUIDES,guideClosedKey} from "@/lib/page-guides";

export function GuideNumber({number}:{number:1|2|3}) {return <span className="guide-no" data-ui="guide-no" aria-hidden="true">{number}</span>;}
export function PageGuide() {
  const pathname=usePathname(), search=useSearchParams();
  const page=findPage(`${pathname}?${search.toString()}`);
  const key=page.navHref??page.href;
  const guide=PAGE_GUIDES[key];
  const [closed,setClosed]=useState(false);
  useEffect(()=>{
    const read=()=>{try{setClosed(localStorage.getItem(guideClosedKey(key))==="closed");}catch{setClosed(false);}};
    read();window.addEventListener("brandy-guidance-change",read);window.addEventListener("storage",read);
    return()=>{window.removeEventListener("brandy-guidance-change",read);window.removeEventListener("storage",read);};
  },[key]);
  if(!guide||closed)return null;
  const next=findPage(guide.next);
  const query=new URLSearchParams(guide.next.split("?")[1]);
  if(guide.next.startsWith("/content/")&&search.get("topic"))query.set("topic",search.get("topic")!);
  const href=`${guide.next.split("?")[0]}${query.size?`?${query}`:""}`;
  return <section className="guide-strip" data-ui="guide-strip" aria-label="이 화면에서 할 일">
    <div className="guide-heading guide-strip-head"><CircleHelp size={16}/><strong className="guide-strip-title">이 화면에서 할 일</strong><span className="guide-strip-next">다음 단계 <Link href={href}>{next.processNumber?`${next.processNumber}. `:""}{next.label} →</Link></span><button type="button" className="icon-button guide-strip-close" aria-label="이 화면 가이드 닫기" onClick={()=>{setClosed(true);try{localStorage.setItem(guideClosedKey(key),"closed");}catch{/* In-memory state remains usable. */}}}><X size={14}/></button></div>
    <ol className="guide-strip-items">{guide.steps.map((step,index)=><li className="guide-item" data-ui="guide-item" key={step}><GuideNumber number={(index+1) as 1|2|3}/><span>{step}</span></li>)}</ol>
  </section>;
}

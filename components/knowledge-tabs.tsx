"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
export function KnowledgeTabs({connections=false}:{connections?:boolean}) {
  const params=useSearchParams();
  const active=connections?"links":params.get("tab")==="canon"?"canon":"documents";
  return <nav className="studio-tabs hub-tabs" aria-label="전체 문서 보기">{[["documents","문서","/knowledge"],["canon","정본","/knowledge?tab=canon"],["links","연결","/knowledge/graph"]].map(([key,label,href])=><Link key={key} className={active===key?"active":""} aria-current={active===key?"page":undefined} href={href}>{label}</Link>)}</nav>;
}

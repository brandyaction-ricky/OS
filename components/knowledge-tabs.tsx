"use client";
import Link from "next/link";
export function KnowledgeTabs({connections=false}:{connections?:boolean}) {
  return <nav className="studio-tabs hub-tabs" aria-label="전체 문서 보기"><Link className={!connections?"active":""} aria-current={!connections?"page":undefined} href="/knowledge">문서</Link><Link className={connections?"active":""} aria-current={connections?"page":undefined} href="/knowledge/graph">연결</Link></nav>;
}

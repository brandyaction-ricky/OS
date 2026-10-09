"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Info, LockKeyhole, Users, ShieldCheck, CalendarDays } from "lucide-react";
import { Header, Card, DocumentRows, NewDocumentButton, Empty } from "./ui";
import { useKnowledge } from "./provider";
import { kstDay } from "@/lib/knowledge/model";
import {useWorkspaceGraph} from "./use-graph";
export function KnowledgeHome() {
  const { state, actor, loading, error } = useKnowledge(); const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(`kw:recent:${actor.ownerId}`) ?? "[]")); } catch { setRecent([]); } }, [actor.ownerId]);
  const active = state.documents.filter(d => d.status !== "archived"), today = kstDay();
  const due = active.filter(d => d.status === "canonical" && d.review_due_on && d.review_due_on < today);
  const todo = state.candidates.filter(c => c.status === "open" && c.submitted_by !== actor.ownerId && c.requested_approver_id === actor.ownerId).length + state.proposals.filter(p => p.status === "open" && p.author_id !== actor.ownerId && p.requested_approver_id === actor.ownerId).length;
  const {graph} = useWorkspaceGraph();
  const weekStart = new Date(today+"T00:00:00+09:00");
  weekStart.setUTCDate(weekStart.getUTCDate()-((new Date(today+"T12:00:00+09:00").getUTCDay()+6)%7));
  const weekEnd = weekStart.getTime()+7*86400000;
  if(error)return <Empty>문서 현황을 확인하지 못했습니다. 위의 다시 불러오기를 눌러 주세요.</Empty>;
  return <><Header title="회사 문서" description={`회사 정본 · 회의록 · 내 노트를 한곳에서 씁니다. 오늘 ${today}`}><Link href="/knowledge/activity">활동 기록</Link><NewDocumentButton/><Link className="kw-primary" href="/knowledge/notes?tab=today">오늘 노트</Link></Header><div className="kw-space-guide"><strong><Info size={16}/>문서는 세 공간 중 하나에 있습니다</strong><div><span><LockKeyhole size={16}/>내 노트 <small>나만 봄</small></span><b>→</b><span><Users size={16}/>팀 문서 <small>팀이 같이 고침</small></span><b>→</b><span><ShieldCheck size={16}/>회사 정본 <small>승인된 기준 (읽기 전용)</small></span><span><CalendarDays size={16}/>회의록 <small>팀원 또는 참석자만 봅니다</small></span></div></div><div className="kw-metrics">{[
    ["오늘 노트", active.some(d => d.daily_on === today && d.owner_id === actor.ownerId) ? "작성 중" : "시작하기", "/knowledge/notes?tab=today"],
    ["내가 볼 검토", todo, "/knowledge/review"], ["이번 주 회의", state.meetings.filter(m => m.starts_at && Date.parse(m.starts_at) >= weekStart.getTime() && Date.parse(m.starts_at) < weekEnd).length, "/knowledge/meetings"], ["검토일 지난 정본", due.length, "/knowledge/canon?filter=overdue"],
  ].map(([label, value, href]) => <Link key={label} className="kw-card" href={String(href)}><small>{label}</small><strong>{loading ? "…" : value}</strong></Link>)}</div><div className="kw-home-grid"><Card title="이어서 보기"><DocumentRows documents={recent.map(id => active.find(d => d.id === id)).filter(d => Boolean(d)).slice(0, 6) as typeof active} empty="최근 연 문서가 없습니다. 팀 문서나 내 노트에서 시작하세요."/></Card><Card title="고정핀"><DocumentRows documents={active.filter(d => state.pins.includes(d.id))} empty="문서 오른쪽 위 핀을 누르면 여기에 고정됩니다"/></Card><Card title="최근 바뀐 정본" href="/knowledge/canon"><DocumentRows documents={active.filter(d => d.status === "canonical").sort((a,b) => b.updated_at.localeCompare(a.updated_at)).slice(0,4)}/></Card><Card title="정리할 것"><div className="kw-cleanup"><Link href="/knowledge/graph?tab=broken"><strong>깨진 연결 {graph?.broken.length ?? "확인 중"}개</strong><small>없는 문서를 가리키는 [[연결]]</small></Link><Link href="/knowledge/canon?filter=nosteward"><strong>담당자 없는 정본 {active.filter(d => d.status === "canonical" && !d.steward_id).length}개</strong><small>검토 담당자를 지정해 주세요</small></Link><Link href="/knowledge/graph?tab=orphan"><strong>연결 안 된 문서 {graph?.nodes.filter(n => !n.incoming && !n.outgoing && n.space !== "ai").length ?? "확인 중"}개</strong><small>다른 문서에서 연결하거나 정리하세요</small></Link><Link href="/knowledge/graph"><strong>AI 작업 기록은 기본 숨김</strong><small>연결 화면에서 켤 수 있습니다</small></Link></div></Card></div></>;
}

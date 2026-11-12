import { redirect } from "next/navigation";
// 회의는 한 화면에서 (대표 요청 2026-11-12): an old 회의록 link opens the same meeting in 업무 기록 › 회의·결정.
export default async function Page({params}:{params:Promise<{id:string}>}){redirect(`/organization/meetings?meeting=${encodeURIComponent((await params).id)}`);}

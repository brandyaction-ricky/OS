import { redirect } from "next/navigation";
// 회의는 한 화면에서 (대표 요청 2026-11-12): the old 회의록 list opens 업무 기록 › 회의·결정.
export default function Page(){redirect("/organization/meetings");}

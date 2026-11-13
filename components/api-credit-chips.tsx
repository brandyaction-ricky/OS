"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Asterisk, Hexagon, type LucideIcon } from "lucide-react";
import { getAnthropicCost, getOpenAiCredit, type ApiCredit, type ClaudeSpend } from "@/lib/api-client";
import { useSession } from "./session-provider";

type Credits = { gpt: ApiCredit | "error" | null; claude: ClaudeSpend | "error" | null };
const DEMO: Credits = {
  gpt: { configured: true, credit: 500, start: "", end: "", spent: 67.5, remaining: 432.5 },
  claude: { configured: true, month: "", spent: 18.4, spent30: 458.3 },
};
const dollars = (value: number) => `$${value < 10 ? value.toFixed(1) : Math.round(value)}`;
const state = (value: Credits[keyof Credits]) => !value ? "…" : value === "error" ? "확인 필요" : !value.configured ? "키 연결 전" : null;
type Row = { name: string; Icon: LucideIcon; cells: string | string[]; note: string };
const gptRow = (value: Credits["gpt"]): Row => {
  const v = value as ApiCredit, cells = state(value) ?? [dollars(v.spent ?? 0), dollars(v.remaining ?? 0)];
  return { name: "GPT", Icon: Hexagon, cells, note: typeof cells === "string" ? `GPT API: ${cells}` : `GPT API: 이달 ${cells[0]} 씀 · ${cells[1]} 남음 (매월 1일 $${v.credit} 충전)` };
};
// Claude: spend only (owner 2026-11-02) — the balance mixes the Ultra grant with card top-ups and has no API.
const claudeRow = (value: Credits["claude"]): Row => {
  const v = value as ClaudeSpend, cells = state(value) ?? [dollars(v.spent ?? 0), "–"];
  return { name: "Claude", Icon: Asterisk, cells, note: typeof cells === "string" ? `Claude API: ${cells}` : `Claude API: 이달 ${cells[0]} 씀 · 최근 30일 ${dollars(v.spent30 ?? 0)} · 남은 금액은 Claude Console에서 봐요` };
};

/**
 * 왼쪽 아래 프로필 위 (owner request 2026-11-02 — the 작동 상태 panel was too hidden): the GPT credit left and spent this cycle
 * and the Claude API spend, for every signed-in member (all staff since 2026-11-13, so they can pace their AI use). Asked once when the shell opens and every 10 minutes while the window is visible.
 */
export function ApiCreditChips() {
  const { accessToken, demo, profile } = useSession();
  const shown = demo || Boolean(profile);
  const [credits, setCredits] = useState<Credits>({ gpt: null, claude: null });
  useEffect(() => {
    if (!shown) return;
    if (demo) { setCredits(DEMO); return; }
    let live = true;
    const read = <K extends keyof Credits>(name: K, get: (token: string | null) => Promise<Exclude<Credits[K], "error" | null>>) =>
      get(accessToken).then((value) => value as Credits[K], () => "error" as Credits[K]).then((value) => { if (live) setCredits((current) => ({ ...current, [name]: value })); });
    const load = () => { void read("gpt", getOpenAiCredit); void read("claude", getAnthropicCost); };
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 10 * 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [accessToken, demo, shown]);
  if (!shown) return null;
  return <Link className="sidebar-credits" href="/settings/connections" title="AI API 크레딧 자세히 보기">
    <span className="sidebar-credit sidebar-credit-head"><span /><span /><small>이달 씀</small><small>남음</small></span>
    {[gptRow(credits.gpt), claudeRow(credits.claude)].map(({ name, Icon, cells, note }) => <span key={name} className="sidebar-credit" title={note}>
      <Icon size={15} aria-hidden="true" /><span>{name}</span>
      {typeof cells === "string" ? <b className="sidebar-credit-wide">{cells}</b> : cells.map((cell, i) => <b key={i}>{cell}</b>)}</span>)}
  </Link>;
}

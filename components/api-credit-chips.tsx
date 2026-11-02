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
const gptText = (value: Credits["gpt"]) => state(value) ?? `${dollars((value as ApiCredit).remaining ?? 0)} 남음 · ${dollars((value as ApiCredit).spent ?? 0)} 씀`;
// Claude: spend only (owner 2026-11-02) — the balance mixes the Ultra grant with card top-ups and has no API.
const claudeText = (value: Credits["claude"]) => state(value) ?? `이달 ${dollars((value as ClaudeSpend).spent ?? 0)} · 30일 ${dollars((value as ClaudeSpend).spent30 ?? 0)}`;

/**
 * 왼쪽 아래 프로필 위 (owner request 2026-11-02 — the 작동 상태 panel was too hidden): the GPT credit left and spent this cycle
 * and the Claude API spend, for admins. Asked once when the shell opens and every 10 minutes while the window is visible.
 */
export function ApiCreditChips() {
  const { accessToken, demo, profile } = useSession();
  const shown = demo || profile?.role === "admin";
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
  const rows: [string, LucideIcon, string][] = [["GPT", Hexagon, gptText(credits.gpt)], ["Claude", Asterisk, claudeText(credits.claude)]];
  return <Link className="sidebar-credits" href="/settings/connections" title="AI API 크레딧 자세히 보기">
    {rows.map(([name, Icon, line]) => <span key={name} className="sidebar-credit" title={`${name} API: ${line}`}>
      <Icon size={15} aria-hidden="true" /><span>{name}</span><b>{line}</b></span>)}
  </Link>;
}

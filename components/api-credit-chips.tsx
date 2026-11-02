"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Asterisk, Hexagon, type LucideIcon } from "lucide-react";
import { getAnthropicCost, getOpenAiCredit, type ApiCredit } from "@/lib/api-client";
import { useSession } from "./session-provider";

const DEMO: Record<"gpt" | "claude", ApiCredit> = {
  gpt: { configured: true, credit: 500, start: "", end: "", spent: 67.5, remaining: 432.5 },
  claude: { configured: true, credit: 200, start: "", end: "", spent: 18.4, remaining: 181.6 },
};
const dollars = (value: number) => `$${value < 10 ? value.toFixed(1) : Math.round(value)}`;
const text = (credit: ApiCredit | "error" | null) => !credit ? "…" : credit === "error" ? "확인 필요" : !credit.configured ? "키 연결 전"
  : `${dollars(credit.remaining ?? 0)} 남음 · ${dollars(credit.spent ?? 0)} 씀`;

/**
 * 왼쪽 아래 프로필 위 (owner request 2026-11-02 — the 작동 상태 panel was too hidden): what is left and spent of this cycle's GPT
 * and Claude API credit, for admins. Asked once when the shell opens and every 10 minutes while the window is visible.
 */
export function ApiCreditChips() {
  const { accessToken, demo, profile } = useSession();
  const shown = demo || profile?.role === "admin";
  const [credits, setCredits] = useState<Record<"gpt" | "claude", ApiCredit | "error" | null>>({ gpt: null, claude: null });
  useEffect(() => {
    if (!shown) return;
    if (demo) { setCredits(DEMO); return; }
    let live = true;
    const read = (name: "gpt" | "claude", get: typeof getOpenAiCredit) => get(accessToken).then((value: ApiCredit | "error") => value, () => "error" as const)
      .then((value) => { if (live) setCredits((current) => ({ ...current, [name]: value })); });
    const load = () => { void read("gpt", getOpenAiCredit); void read("claude", getAnthropicCost); };
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 10 * 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [accessToken, demo, shown]);
  if (!shown) return null;
  const rows: [string, LucideIcon, ApiCredit | "error" | null][] = [["GPT", Hexagon, credits.gpt], ["Claude", Asterisk, credits.claude]];
  return <Link className="sidebar-credits" href="/settings/connections" title="AI API 크레딧 자세히 보기">
    {rows.map(([name, Icon, credit]) => <span key={name} className="sidebar-credit" title={`${name} API 크레딧: ${text(credit)}`}>
      <Icon size={15} aria-hidden="true" /><span>{name}</span><b>{text(credit)}</b></span>)}
  </Link>;
}

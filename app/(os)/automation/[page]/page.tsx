import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ContentAutomationV07 } from "@/components/content-automation-v07";
import { PlaceholderPage } from "@/components/placeholder-page";
import { retiredRoute } from "@/lib/final-routes";
import { findPage, NAV_STAGES } from "@/lib/navigation";

// 자동화 screens have their own route so their code is a separate download from the other menus (app/(os)/[stage]/[page]).
type AutomationPageProps = { params: Promise<{ page: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: AutomationPageProps): Promise<Metadata> {
  const resolved = await params;
  const query = await searchParams;
  const page = findPage(`/automation/${resolved.page}?tab=${typeof query.tab === "string" ? query.tab : ""}`);
  return { title: `${page.label} | 브랜디 OS` };
}

export default async function AutomationPage({ params }: AutomationPageProps) {
  const href = `/automation/${(await params).page}`;
  const legacy = retiredRoute(href);
  if (legacy) redirect(legacy);
  if (href === "/automation/topics") return <ContentAutomationV07 page="topics" />;
  if (href === "/automation/references") return <ContentAutomationV07 page="references" />;
  if (href === "/automation/cardnews") return <ContentAutomationV07 page="cardnews" />;
  if (href === "/automation/shorts") return <ContentAutomationV07 page="shorts" />;
  if (href === "/automation/threads") return <ContentAutomationV07 page="threads" />;
  if (href === "/automation/dashboard") return <ContentAutomationV07 page="dashboard" />;
  if (href === "/automation/review") return <ContentAutomationV07 page="review" />;
  if (href === "/automation/requests") return <ContentAutomationV07 page="requests" />;
  if (href === "/automation/library") redirect("/automation/dashboard?moved=library");
  if (href === "/automation/calendar") return <ContentAutomationV07 page="calendar" />;
  if (href === "/automation/performance") return <ContentAutomationV07 page="performance" />;
  if (href === "/automation/templates") redirect("/automation/settings?tab=templates");
  if (href === "/automation/settings") return <ContentAutomationV07 page="settings" />;
  const stage = NAV_STAGES.find((item) => item.pages.some((page) => page.href === href));
  return <PlaceholderPage title={stage?.pages.find((item) => item.href === href)?.label ?? "기능 준비"} stage={stage?.label ?? "OS"} />;
}

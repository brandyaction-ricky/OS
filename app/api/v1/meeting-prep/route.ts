import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { buildPerformanceSignal } from "@/lib/performance-signals";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const brand = url.searchParams.get("brand")?.trim() || "";
    const team = url.searchParams.get("team")?.trim() || "";
    const scoped = (type: string, limit: number) => {
      let query = actor.supabase.from("os_records").select("*").eq("record_type", type).is("archived_at", null).order("updated_at", { ascending: false }).limit(limit);
      if (brand) query = query.eq("brand", brand);
      if (team) query = query.eq("team", team);
      return query;
    };
    const [meetings, tasks, kpis] = await Promise.all([scoped("meeting", 10), scoped("task", 100), scoped("kpi", 20)]);
    const error = meetings.error || tasks.error || kpis.error;
    if (error) throw new ApiError(400, "MEETING_PREP_FAILED", "회의 준비 자료를 불러오지 못했습니다.", error.message);
    const latest = (meetings.data ?? []).find((item) => item.status === "done") ?? meetings.data?.[0] ?? null;
    const pending = Array.isArray(latest?.metadata?.pending) ? latest.metadata.pending.map(String) : [];
    const openTodos = (tasks.data ?? []).filter((item) => !["done", "cancelled"].includes(item.status)).slice(0, 30);
    const latestKpis = (kpis.data ?? []).slice(0, 12).map((item) => {
      const current = Number(item.metric_current ?? 0); const previous = Number(item.metadata?.previousValue ?? 0);
      const signal = buildPerformanceSignal({ title: item.title, current, previous, target: Number(item.metric_target ?? 0) || null, unit: item.metric_unit });
      return { id: item.id, title: item.title, current, previous, unit: item.metric_unit, signal: signal.label };
    });
    return NextResponse.json({ latestMeeting: latest ? { id: latest.id, title: latest.title, date: latest.starts_at, pending } : null, pending, todos: openTodos, kpis: latestKpis });
  } catch (error) { return apiErrorResponse(error); }
}

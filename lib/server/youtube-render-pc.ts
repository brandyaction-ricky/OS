import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { engineBundleSaved } from "./render-engine";
import { YOUTUBE_RENDER_RUN_KIND } from "./youtube-render-run";
import { YOUTUBE_VOICE_RUN_KIND, YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// The always-on render PC (Mac mini, owner decision 2026-10-17) reports itself once a minute. The latest report is one
// small JSON object in the private JSON-only bucket, overwritten each time, so no table, migration or row history grows.
const STATUS_PATH = "render-pc/status.json";
export const RENDER_PC_MIN_DISK_GB = 60; // one render decodes about 45 GB of deck frames
const OFFLINE_AFTER_SECONDS = 5 * 60;
// More render PCs (owner decision 2026-10-27, set up 2026-11-08): each reports under its own name in its own file. The one file of a
// worker that sends no name is read only while no named PC has reported.
export const RENDER_PC_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const pcPath = (name: string) => `render-pc/pcs/${name}.json`;
/** A video stays with the render PC that made its voice; off this long (and not working on it), the video moves to another. */
export const RENDER_PC_GONE_SECONDS = 30 * 60;

export const renderPcSignalSchema = z.object({
  action: z.literal("heartbeat"),
  diskFreeGb: z.number().min(0).max(1_000_000),
  memUsedGb: z.number().min(0).max(4_096),
  memTotalGb: z.number().min(0).max(4_096),
  job: z.object({ renderId: z.string().uuid().optional(), step: z.enum(["voice", "download", "narration", "drawing", "upload"]) }).strict().nullable(),
  packageName: z.string().trim().max(80).optional(),
  // 내 컴퓨터로 시안 (2026-10-27): a hash of the v13 engine (Logan's package, the diagrams, fonts, Python packages). A staff Mac
  // makes ③ drafts only while its hash equals the render PC's, so a draft looks like the full video the render PC makes later.
  engine: z.string().regex(/^[a-f0-9]{16,64}$/).optional(),
  pc: z.string().regex(RENDER_PC_NAME).optional(),
}).strict();
// since: when a named PC began reporting its current engine.
type Signal = Omit<z.infer<typeof renderPcSignalSchema>, "action" | "pc"> & { at: string; since?: string };
type Pc = Signal & { name: string };

export async function saveRenderPcSignal(input: z.infer<typeof renderPcSignalSchema>) {
  const signal = signalOf(input);
  // A PC whose engine differs from the other PCs' takes no work, so every video is drawn with the one engine staff PCs match.
  let held = false;
  if (input.pc && input.engine) {
    const pcs = await readPcs(), before = pcs.find((pc) => pc.name === input.pc);
    signal.since = before?.engine === input.engine ? before.since ?? before.at : signal.at;
    // The single file of a worker without a name is not read once a named PC reports, so it never holds one.
    held = fleetEngine([...pcs.filter((pc) => pc.name && pc.name !== input.pc), { ...signal, name: input.pc }]) !== input.engine;
  }
  await writeSignal(input.pc ? pcPath(input.pc) : STATUS_PATH, signal);
  // engineBundle false: the render PC packs and uploads its engine for staff PCs (once per fingerprint, when idle).
  return { ok: true, acceptsWork: input.diskFreeGb >= RENDER_PC_MIN_DISK_GB && !held, ...(held ? { engineHeld: true } : {}),
    ...(input.engine && !held ? { engineBundle: await engineBundleSaved(input.engine) } : {}) };
}
/** The render PCs' engine fingerprint, if any PC reported one. */
export const renderPcEngine = async () => fleetEngine(await readPcs());
/** The named render PC has been off for half an hour (or never reported). */
export async function renderPcGone(name: string) {
  const signal = RENDER_PC_NAME.test(name) ? await readSignal(pcPath(name)) : null;
  return !signal || ageOf(signal)! > RENDER_PC_GONE_SECONDS;
}
const signalOf = (input: z.infer<typeof renderPcSignalSchema>): Signal => ({ diskFreeGb: input.diskFreeGb, memUsedGb: input.memUsedGb, memTotalGb: input.memTotalGb,
  job: input.job, packageName: input.packageName, ...(input.engine ? { engine: input.engine } : {}), at: new Date().toISOString() });
async function readPcs(): Promise<Pc[]> {
  const listed = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).list("render-pc/pcs", { limit: 100 });
  const names = (listed.data ?? []).map((file) => file.name.replace(/\.json$/, "")).filter((name) => RENDER_PC_NAME.test(name));
  const named = (await Promise.all(names.map(async (name) => { const signal = await readSignal(pcPath(name)); return signal && { ...signal, name }; })))
    .filter((pc): pc is Pc => pc !== null);
  if (named.length) return named;
  const single = await readSignal(STATUS_PATH);
  return single ? [{ ...single, name: "" }] : [];
}
const online = (signal: Signal) => ageOf(signal)! <= OFFLINE_AFTER_SECONDS;
/** The engine most online PCs run; on a tie the one running longest, so a PC that joins never holds a PC already at work. */
function fleetEngine(pcs: Pc[]) {
  const counts = new Map<string, { n: number; since: number }>();
  for (const pc of pcs) if (pc.engine && online(pc)) {
    const seen = counts.get(pc.engine), since = Date.parse(pc.since ?? pc.at);
    counts.set(pc.engine, { n: (seen?.n ?? 0) + 1, since: Math.min(seen?.since ?? since, since) });
  }
  return [...counts].sort(([a, x], [b, y]) => y.n - x.n || x.since - y.since || (a < b ? -1 : 1))[0]?.[0]
    ?? pcs.filter((pc) => pc.engine).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.engine;
}
async function writeSignal(path: string, signal: Signal) {
  const { error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET)
    .upload(path, new Blob([JSON.stringify(signal)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new ApiError(503, "RENDER_PC_SIGNAL_FAILED", "영상 만드는 컴퓨터 신호를 저장하지 못했습니다.");
}
async function readSignal(path: string) {
  const file = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(path);
  if (file.error || !file.data) return null;
  try { return JSON.parse(await file.data.text()) as Signal; } catch { return null; }
}
const ageOf = (signal: Signal | null) => signal ? Math.max(0, Math.round((Date.now() - Date.parse(signal.at)) / 1000)) : null;

// A staff Mac reports the same signal under its owner's id; nothing else of the member is kept.
const localPath = (ownerId: string) => `render-pc/local/${ownerId}.json`;
export async function saveLocalRenderSignal(ownerId: string, input: z.infer<typeof renderPcSignalSchema>) {
  await writeSignal(localPath(ownerId), signalOf(input));
  return { ok: true, acceptsWork: true };
}
/** 내 컴퓨터: on or off, and whether its engine is the render PC's (unknown until the render PC reports its own). */
export async function readLocalRenderStatus(ownerId: string) {
  const [mine, pcEngine] = await Promise.all([readSignal(localPath(ownerId)), renderPcEngine()]);
  const ageSeconds = ageOf(mine);
  return {
    state: mine === null ? "unknown" as const : ageSeconds! > OFFLINE_AFTER_SECONDS ? "offline" as const : "online" as const,
    lastSignalAt: mine?.at ?? null, ageSeconds, job: mine?.job ?? null,
    engine: !mine?.engine || !pcEngine ? "unknown" as const : mine.engine === pcEngine ? "same" as const : "different" as const,
  };
}
/** A staff Mac may take a ③ draft only with the render PC's engine. */
export async function assertLocalEngine(engine: string) {
  const pcEngine = await renderPcEngine();
  if (!pcEngine) throw new ApiError(409, "MYIN_ENGINE_UNKNOWN", "영상 만드는 컴퓨터의 엔진 버전을 아직 몰라요. 영상 만드는 컴퓨터로 만들어 주세요.");
  if (pcEngine !== engine) throw new ApiError(409, "MYIN_ENGINE_DIFFERENT", "내 컴퓨터의 엔진이 영상 만드는 컴퓨터와 달라요. 새 엔진을 받은 뒤 다시 켜 주세요.");
}

/** What the 영상 제작 screen shows: on or off, last signal, current job, disk, and the queue in front of new work, for every render PC. */
export async function readRenderPcStatus() {
  const service = createServiceSupabase();
  const [pcs, queue, recent] = await Promise.all([
    readPcs(),
    service.from("os_records").select("metadata->>kind,status").eq("record_type", "ai_job").in("metadata->>kind", [YOUTUBE_VOICE_RUN_KIND, YOUTUBE_RENDER_RUN_KIND])
      .in("status", ["backlog", "in_progress"]).is("archived_at", null).limit(200),
    service.from("os_records").select("created_at,updated_at").eq("record_type", "ai_job").eq("metadata->>kind", YOUTUBE_RENDER_RUN_KIND)
      .eq("status", "done").is("archived_at", null).order("updated_at", { ascending: false }).limit(5),
  ]);
  const engine = fleetEngine(pcs);
  const list = pcs.map((pc) => ({ name: pc.name, state: online(pc) ? "online" as const : "offline" as const, ageSeconds: ageOf(pc), job: pc.job ?? null,
    diskFreeGb: pc.diskFreeGb, lowDisk: pc.diskFreeGb < RENDER_PC_MIN_DISK_GB, engineDifferent: Boolean(pc.engine && engine && pc.engine !== engine) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The single-PC fields: the busy PC, else any PC that is on, else the one heard from last.
  const lead = [...pcs].sort((a, b) => Number(online(b)) - Number(online(a)) || Number(Boolean(b.job)) - Number(Boolean(a.job)) || Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const ageSeconds = ageOf(lead);
  const minutes = (recent.data ?? []).map(row => (Date.parse(row.updated_at) - Date.parse(row.created_at)) / 60_000).filter(value => value > 0 && value < 24 * 60);
  const rows = (queue.data ?? []) as { kind: string; status: string }[];
  return {
    state: lead === null ? "unknown" as const : online(lead) ? "online" as const : "offline" as const,
    lastSignalAt: lead?.at ?? null, ageSeconds,
    diskFreeGb: lead?.diskFreeGb ?? null, lowDisk: lead ? lead.diskFreeGb < RENDER_PC_MIN_DISK_GB : false,
    memUsedGb: lead?.memUsedGb ?? null, memTotalGb: lead?.memTotalGb ?? null, job: lead?.job ?? null, packageName: lead?.packageName ?? null,
    pcs: list,
    // ponytail: counts across all videos; per-video position arrives with the v1 제작 screen.
    queue: { voice: rows.filter(row => row.kind === YOUTUBE_VOICE_RUN_KIND).length, render: rows.filter(row => row.kind === YOUTUBE_RENDER_RUN_KIND).length },
    averageRenderMinutes: minutes.length ? Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length) : null,
  };
}

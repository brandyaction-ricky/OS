// 스튜디오 작업 (2026-11-06 staff request): YouTube's API takes no end screen, no 테스트 및 비교 and no comment pin, so after the upload
// the OS queues them and the uploader's own AI does them in YouTube Studio on their own Chrome, then reports back.
import type { EditLock } from "../myin-edit.ts";
import { finalPair, SLOTS, type YpMake, type YpPlan } from "./stages.ts";

export const STUDIO_KIND = "youtube_studio_v1";
export const STUDIO_ITEMS = ["endscreen", "test", "pin"] as const;
export type StudioItem = typeof STUDIO_ITEMS[number];
export const STUDIO_ITEM_NAME: Record<StudioItem, string> = { endscreen: "최종 화면", test: "제목 · 썸네일 테스트", pin: "고정 댓글" };
/** The OS document the AI follows in Studio; when Studio changes, only that document changes. */
export const STUDIO_PROCEDURE_TITLE = "유튜브 스튜디오 작업 절차";
/** A scheduled video takes comments once it is public: the pin is asked for five minutes after the publish time. */
export const PIN_AFTER_MS = 5 * 60_000;

export interface StudioReport { done: boolean; at: string; by: string; name: string; note: string; kind?: string }
export interface StudioTask { kind: typeof STUDIO_KIND; videoId: string; queuedAt: string; channel: { id: string; title: string; ownerId: string };
  lock?: EditLock | null; reports: Partial<Record<StudioItem, StudioReport>> }
export type StudioState = "ready" | "later" | "done" | "failed" | "none";

/** Which 테스트 및 비교 the confirmed A · B · C make: titles, thumbnails or both differ ("" = nothing to test). */
export function testKind(plan: Pick<YpPlan, "confirmed">, make: Pick<YpMake, "aTitle" | "aReason" | "edits" | "thumbs">) {
  const pairs = SLOTS.map(slot => finalPair(plan, make, slot)).filter(Boolean);
  if (pairs.length < 2) return "";
  const titles = new Set(pairs.map(pair => pair!.title.trim())).size > 1;
  const thumbs = new Set(SLOTS.filter(slot => plan.confirmed?.[slot]).map(slot => make.thumbs[slot]?.path ?? slot)).size > 1;
  return titles && thumbs ? "제목과 썸네일" : thumbs ? "썸네일만" : titles ? "제목만" : "";
}

/** When the pinned comment can go: 5 minutes after a scheduled publish, now for a public or unlisted video, never for a private one (null). */
export function pinFrom(video: { privacy?: string; publishAt?: string | null; at: string }) {
  if (video.publishAt) return new Date(Date.parse(video.publishAt) + PIN_AFTER_MS).toISOString();
  return video.privacy === "public" || video.privacy === "unlisted" ? video.at : null;
}

/** Each item as the screen and the AI see it: reported, waiting for the video to be public, nothing to do, or ready now. */
export function studioStates(task: Pick<StudioTask, "reports">, video: { privacy?: string; publishAt?: string | null; at: string }, test: string, now: number) {
  const pin = pinFrom(video);
  return Object.fromEntries(STUDIO_ITEMS.map(item => {
    const report = task.reports[item];
    const state: StudioState = report ? report.done ? "done" : "failed" : item === "test" && !test ? "none"
      : item === "pin" && (!pin || Date.parse(pin) > now) ? "later" : "ready";
    return [item, { state, ...(report ? { at: report.at, name: report.name, note: report.note, ...(report.kind ? { kind: report.kind } : {}) } : {}), ...(item === "pin" ? { from: pin } : {}) }];
  })) as Record<StudioItem, { state: StudioState; at?: string; name?: string; note?: string; kind?: string; from?: string | null }>;
}

/** The task is settled once nothing is ready or waiting (a 못 함 waits for a person to hand it over again). */
export const studioSettled = (states: Record<StudioItem, { state: StudioState }>) => STUDIO_ITEMS.every(item => !["ready", "later"].includes(states[item].state));

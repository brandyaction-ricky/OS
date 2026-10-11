import type { Meeting } from "../knowledge/model";
import { teamBusiness } from "./business.ts";

function kstDay(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "";
}

export function wordSimilarity(first: string, second: string) {
  const words = (value: string) => new Set(value.toLocaleLowerCase().replace(/회의|\d+/g, " ").split(/[^가-힣a-z]+/).filter(Boolean));
  const a = words(first), b = words(second);
  if (!a.size && !b.size) return first.trim() === second.trim() ? 1 : 0;
  return [...a].filter(word => b.has(word)).length / new Set([...a, ...b]).size;
}

export function legacyMeetingPairs(meetings: Meeting[]) {
  const legacy = meetings.filter(meeting => meeting.legacy && !meeting.metadata.migratedTo && kstDay(meeting.starts_at));
  const pairs: Array<{ first: Meeting; second: Meeting }> = [];
  for (let index = 0; index < legacy.length; index++) for (let other = index + 1; other < legacy.length; other++) {
    const a = legacy[index], b = legacy[other];
    if (kstDay(a.starts_at) !== kstDay(b.starts_at)) continue;
    const businessA = teamBusiness(a.brand ?? "")?.key ?? a.brand?.trim();
    const businessB = teamBusiness(b.brand ?? "")?.key ?? b.brand?.trim();
    if (!businessA || businessA !== businessB) continue;
    if (wordSimilarity(a.title, b.title) >= 0.4 || a.title.trim() === b.title.trim()) pairs.push({ first: a, second: b });
  }
  return pairs;
}

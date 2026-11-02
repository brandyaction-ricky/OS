// 검토할 사람 · 날짜 (유쓰 요청 8/8, 2026-11-02): the 최종 검토 names who checks which part by when. It is no approval step: nothing
// waits on it, a passed date confirms nothing, and only the reviewers who have not finished are reminded (each once a day).
import { z } from "zod";

export interface YpReviewer { id: string; part: string; due: string; doneAt?: string }
export const MAX_REVIEWERS = 6;
export const reviewerInput = z.object({ id: z.string().uuid(), part: z.string().trim().max(20), due: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/) }).strict();

/** The new list as written by the PD: a reviewer kept with the same part keeps their 검토 끝; the people newly given a part (or a new date) are told. */
export function setReviewers(prev: YpReviewer[], next: z.infer<typeof reviewerInput>[]) {
  const seen = new Set<string>();
  const list = next.filter(row => !seen.has(`${row.id}:${row.part}`) && seen.add(`${row.id}:${row.part}`)).slice(0, MAX_REVIEWERS).map(row => {
    const before = prev.find(old => old.id === row.id && old.part === row.part);
    return { id: row.id, part: row.part, due: row.due, ...(before?.doneAt ? { doneAt: before.doneAt } : {}) };
  });
  const told = [...new Set(list.filter(row => !row.doneAt && !prev.some(old => old.id === row.id && old.part === row.part && old.due === row.due)).map(row => row.id))];
  return { list, told };
}

/** 검토 끝 (or 다시 열기) by the reviewer: every part they hold. */
export function markReviewed(list: YpReviewer[], me: string, done: boolean, at: string) {
  if (!list.some(row => row.id === me)) return null;
  return list.map(row => row.id !== me ? row : done ? { ...row, doneAt: row.doneAt ?? at } : { id: row.id, part: row.part, due: row.due });
}

/** Today in Korea (YYYY-MM-DD). */
export const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
/** Who to remind today: not finished, with a date that has come. */
export const dueReviewers = (list: YpReviewer[], today: string) => [...new Set(list.filter(row => !row.doneAt && row.due && row.due <= today).map(row => row.id))];

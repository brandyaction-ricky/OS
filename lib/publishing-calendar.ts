export const PUBLICATION_FORMATS=[
  {id:"yt_long",label:"유튜브 롱폼"},{id:"yt_shorts",label:"유튜브 쇼츠"},
  {id:"ig_carousel",label:"인스타 카드뉴스"},{id:"ig_reel",label:"인스타 릴스"},
  {id:"threads",label:"Threads"},{id:"seo_column",label:"SEO 칼럼"},{id:"essay",label:"에세이"},
] as const;
export function publicationCalendarFormat(record:{metadata:Record<string,unknown>}){
  const format=String(record.metadata.platformFormat??"");
  if(format.startsWith("threads"))return "threads";
  if(PUBLICATION_FORMATS.some(item=>item.id===format))return format;
  return ({youtube:"yt_long",shorts:"yt_shorts",instagram:"ig_carousel",threads:"threads",column:"seo_column",essay:"essay"} as Record<string,string>)[String(record.metadata.platform??"")]??"yt_long";
}

export function localCalendarDate(value: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localCalendarTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function canMovePublication(status: string) {
  return ["draft", "review", "ready", "scheduled", "blocked"].includes(status);
}

export function movePublicationDate(record: { status: string; starts_at: string | null }, targetDate: string) {
  if (!canMovePublication(record.status) || !record.starts_at || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const current = new Date(record.starts_at);
  const target = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(target.getTime()) || localCalendarDate(target) !== targetDate) return null;
  target.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds());
  // Moving a draft/review item adjusts its proposed time, never grants publishing approval.
  return { startsAt: target.toISOString() };
}

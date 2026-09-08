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

export function recordDateColumn(type: string) {
  return type === "task" || type === "contract" ? "due_date" : "starts_at";
}

export function validDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function recordDateRange(from: string | null, to: string | null) {
  if (!from && !to) return null;
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from >= to)) return null;
  return { from, to };
}

/** Unknown measurements stay null; a recorded zero is a real value. */
export function measuredNumber(value: unknown): number | null {
  if (value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function measuredSum(values: unknown[]): number | null {
  const measured = values.map(measuredNumber).filter((value): value is number => value !== null);
  return measured.length ? measured.reduce((sum, value) => sum + value, 0) : null;
}
export function safeRatio(numerator: unknown, denominator: unknown, scale = 1): number | null {
  const top = measuredNumber(numerator), bottom = measuredNumber(denominator);
  return top === null || bottom === null || bottom === 0 ? null : measuredNumber(top / bottom * scale);
}
export function formatMoney(value: unknown): string {
  const number = measuredNumber(value);
  return number === null ? "—" : `${(number / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`;
}
export function formatNumber(value: unknown, suffix = "", digits = 0): string {
  const number = measuredNumber(value);
  return number === null ? "—" : `${number.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}
export function formatRatio(value: unknown): string { return formatNumber(value, "배", 2); }

export function measuredMedian(values: unknown[]): number | null {
  const measured = values.map(measuredNumber).filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!measured.length) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 ? measured[middle] : (measured[middle - 1] + measured[middle]) / 2;
}

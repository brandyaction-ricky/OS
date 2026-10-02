import { measuredNumber } from "./metric-format.ts";
export function revenueNet(record: { amount: unknown; metadata: Record<string, unknown> }): number | null {
  const explicit = measuredNumber(record.metadata.net);
  if (explicit !== null) return explicit;
  const gross = measuredNumber(record.metadata.gross);
  if (gross !== null) return gross - (measuredNumber(record.metadata.cancel) ?? 0) - (measuredNumber(record.metadata.refund) ?? 0);
  return measuredNumber(record.amount);
}

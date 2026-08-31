const FORBIDDEN_COPY_TERMS = [
  /clifton\s*strengths?/gi,
  /strengths?finder/gi,
  /gallup/gi,
  /갤럽\s*강점/gi,
  /갤럽/gi,
  /강점\s*검사/gi,
  /스트렝스\s*파인더/gi,
] as const;

const REMOVED_INTERNAL_TERMS = [/대상\s*a/gi, /모방\s*욕망/gi, /개성화/gi] as const;

export function sanitizePublicCopy(value: string) {
  let result = value;
  for (const pattern of FORBIDDEN_COPY_TERMS) result = result.replace(pattern, "강점");
  for (const pattern of REMOVED_INTERNAL_TERMS) result = result.replace(pattern, "");
  return result.replace(/강점(?:\s*·\s*강점|\s*,\s*강점)+/g, "강점").replace(/[ \t]{2,}/g, " ").trim();
}

export function sanitizePublicCopyValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizePublicCopy(value);
  if (Array.isArray(value)) return value.map(sanitizePublicCopyValue).filter((item) => item !== "");
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizePublicCopyValue(item)]));
  return value;
}

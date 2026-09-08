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

export const PUBLIC_COPY_GUIDANCE = "시청자에게 보이는 제목·카피·본문은 쉬운 일상어로 작성. 배선·대상a·결핍·증환·개성화·모방욕망 등 내부 분석 용어를 그대로 출력하지 말고 시청자의 상황과 행동으로 풀어 쓴다.";

export function sanitizePublicCopy(value: string) {
  let result = value.replace(/배선/g, "생각의 연결").replace(/결핍/g, "부족함").replace(/증환/g, "반복되는 어려움");
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

import { z, ZodIssueCode, type ZodErrorMap } from "zod";

// 로건 QA 10/30: a staff AI's 기획안 came back six times with 「body Expected string, received array」-style English, which neither the
// AI's PD nor a person fixing it by hand could read. Importing this makes zod checks in that server explain themselves in Korean
// (a message written on the schema still wins).
const TYPE: Record<string, string> = { string: "글", number: "숫자", integer: "정수", bigint: "정수", boolean: "참 · 거짓", array: "목록", object: "묶음", null: "빈 값", undefined: "빠진 값", date: "날짜" };
const name = (type: string) => TYPE[type] ?? type;
// The last letter's 받침 picks the particle: 목록으로 · 숫자로 · 글로 (ㄹ takes 로), 목록이에요 · 숫자예요.
const final = (word: string) => { const code = word.charCodeAt(word.length - 1) - 0xac00; return code >= 0 && code < 11172 ? code % 28 : 0; };
const as = (word: string) => `${word}${[0, 8].includes(final(word)) ? "로" : "으로"}`;
const is = (word: string) => `${word}${final(word) ? "이에요" : "예요"}`;

export const koreanErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "빠졌어요 — 꼭 넣는 칸이에요" : `${as(name(issue.expected))} 써 주세요 — 지금은 ${is(name(issue.received))}` };
    case ZodIssueCode.too_small:
      return { message: issue.type === "array" ? `${issue.minimum}개 이상이어야 해요` : issue.type === "string" ? (Number(issue.minimum) <= 1 ? "비어 있으면 안 돼요" : `${issue.minimum}자 이상이어야 해요`) : `${issue.minimum} 이상이어야 해요` };
    case ZodIssueCode.too_big:
      return { message: issue.type === "array" ? `${issue.maximum}개까지예요` : issue.type === "string" ? `${issue.maximum}자까지예요` : `${issue.maximum} 이하여야 해요` };
    case ZodIssueCode.unrecognized_keys:
      return { message: `정해진 칸이 아니에요: ${issue.keys.join(", ")}` };
    case ZodIssueCode.invalid_enum_value:
      return { message: `이 중 하나로 써 주세요: ${issue.options.join(", ")}` };
    default:
      return { message: ctx.defaultError };
  }
};
z.setErrorMap(koreanErrorMap);

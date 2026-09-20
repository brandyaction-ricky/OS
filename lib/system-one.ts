import { z } from "zod";

// Local-only contract exercise. None of these client-supplied values authorize
// real document access; a connected implementation must load them on the server.
export const JUDGMENT_LABELS = {
  adopt: "채택", revise: "수정", hold: "보류", block: "차단", human_review: "사람 검토",
} as const;
export const judgmentSchema = z.enum(["adopt", "revise", "hold", "block", "human_review"]);
export type Judgment = z.infer<typeof judgmentSchema>;
const text = z.string().trim().min(1).max(2000);
const id = z.string().trim().min(1).max(100);
const version = z.number().int().positive().nullable();
const snapshotSchema = z.object({
  id, title: text, version, state: z.enum(["current", "replaced", "protected", "unknown"]),
  access: z.enum(["allowed", "denied", "unknown"]),
  checkedAt: z.string().datetime().nullable(), fingerprint: id.nullable(),
  body: z.string().min(1).max(12000).refine((body) => body.trim().length > 0),
}).strict();
const criterionSchema = z.object({
  document: snapshotSchema, section: text,
  applicability: z.enum(["applies", "not_applicable", "exception", "unknown"]),
  reason: text,
}).strict();
const evidenceSchema = z.object({
  id, label: text, kind: z.enum(["fact", "interpretation", "hypothesis"]),
  origin: z.enum(["original", "derivative"]),
  availability: z.enum(["read", "not_opened", "not_found", "retrieval_error"]),
  reference: text, version, section: text, excerpt: z.string().max(2000),
  observedAt: z.string().datetime().nullable(),
}).strict();
export const CHECK_LABELS = {
  passed: "확인", revise: "수정 필요", missing: "자료 필요", conflict: "기준 충돌",
  forbidden: "권한·금지 위반", not_applicable: "적용 제외",
} as const;
const checkSchema = z.object({
  id, label: text, status: z.enum(["passed", "revise", "missing", "conflict", "forbidden", "not_applicable"]),
  reason: text, nextAction: text, criterionId: id, evidenceIds: z.array(id).max(20),
}).strict();
export const mockInputSchema = z.object({
  contractVersion: z.literal("mock-0.1"), domain: z.literal("content"),
  source: snapshotSchema, criteria: z.array(criterionSchema).min(1).max(10),
  question: text, currentStage: text, nextStage: text,
  format: z.enum(["information", "board", "script"]), latestRequest: text,
  included: z.array(text).min(1).max(10), excluded: z.array(text).max(10),
  evidence: z.array(evidenceSchema).max(20), checks: z.array(checkSchema).min(1).max(30),
  requestedAction: z.enum(["review", "share", "publish"]),
  authorization: z.object({
    scope: text, externalAction: z.enum(["allowed", "denied", "unknown"]),
    requestedRecipients: z.array(id).max(20), authorizedRecipients: z.array(id).max(20),
  }).strict(),
}).strict().superRefine((input, ctx) => {
  const rules = new Set(input.criteria.map((item) => item.document.id));
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  for (const [key, ids] of [
    ["criteria", input.criteria.map((item) => item.document.id)],
    ["evidence", input.evidence.map((item) => item.id)],
    ["checks", input.checks.map((item) => item.id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: [key], message: "중복 식별자" });
  }
  input.checks.forEach((check, index) => {
    if (new Set(check.evidenceIds).size !== check.evidenceIds.length) {
      ctx.addIssue({ code: "custom", path: ["checks", index], message: "같은 근거를 중복 계산할 수 없음" });
    }
    if (!rules.has(check.criterionId) || check.evidenceIds.some((ref) => !evidenceIds.has(ref))) {
      ctx.addIssue({ code: "custom", path: ["checks", index], message: "근거 참조가 연결되지 않음" });
    }
    const criterion = input.criteria.find((item) => item.document.id === check.criterionId);
    if (criterion && (criterion.applicability === "not_applicable" || criterion.applicability === "exception") && check.status !== "not_applicable") {
      ctx.addIssue({ code: "custom", path: ["checks", index], message: "적용 제외 기준을 합격·결함으로 판단할 수 없음" });
    }
    if (check.status === "passed" && check.evidenceIds.some((ref) => input.evidence.find((item) => item.id === ref)?.availability !== "read")) {
      ctx.addIssue({ code: "custom", path: ["checks", index], message: "읽지 못한 자료를 확인 근거로 사용할 수 없음" });
    }
  });
});
export type MockInput = z.infer<typeof mockInputSchema>;
export type Check = MockInput["checks"][number];
export type MockFailure = "timeout" | "invalid_output" | "budget";
export type RunFailure = {
  status: "stopped" | "failed"; judgment: null;
  code: "invalid_input" | "access_denied" | "metadata_missing" | "not_current" | MockFailure;
  message: string;
};
export type MockRun = {
  status: "succeeded"; id: string; at: string; mode: "mock";
  judgment: Judgment; summary: string; input: MockInput; signature: string;
  executionAllowed: false; modelCost: null; accuracy: null;
};
export type RunResult = MockRun | RunFailure;
const summaries: Record<Judgment, string> = {
  adopt: "요청한 다음 검토 단계로 넘길 수 있다는 모의 추천입니다. 게시 승인이 아닙니다.",
  revise: "구체적인 수정 사항을 반영한 뒤 같은 범위를 다시 검토하세요.",
  hold: "필수 자료가 부족합니다. 이미 확인된 수정 사항도 함께 확인하세요.",
  block: "요청 행동에 확인된 권한·금지 위반이 있어 진행할 수 없습니다.",
  human_review: "기준 충돌 또는 권한자의 선택이 필요합니다. 임의로 통과시키지 않습니다.",
};
const failureMessages: Record<MockFailure, string> = {
  timeout: "모의 시간 초과입니다. 판단 결과가 없으며 자동 재시도하지 않습니다.",
  invalid_output: "모의 출력 형식 오류입니다. 판단 결과로 사용하지 않습니다.",
  budget: "모의 예산 확인 실패입니다. 비용 확인 전 실행하지 않습니다.",
};

function snapshots(input: MockInput) {
  return [input.source, ...input.criteria.map((item) => item.document)];
}

export function validateMockInput(value: unknown): { ok: true; input: MockInput } | { ok: false; failure: RunFailure } {
  const parsed = mockInputSchema.safeParse(value);
  if (!parsed.success) return { ok: false, failure: {
    status: "stopped", judgment: null, code: "invalid_input",
    message: "입력 형식·필수 항목·길이·근거 참조를 확인하세요. 내용을 임의로 잘라내지 않습니다.",
  } };
  const input = parsed.data;
  if (snapshots(input).some((item) => item.access === "denied")) return { ok: false, failure: {
    status: "stopped", judgment: null, code: "access_denied",
    message: "접근이 취소되어 입력과 결과를 표시하지 않습니다.",
  } };
  if (snapshots(input).some((item) => item.version === null || item.state === "unknown" || item.access === "unknown" || !item.checkedAt || !item.fingerprint)
    || input.criteria.some((item) => item.applicability === "unknown")) return { ok: false, failure: {
    status: "stopped", judgment: null, code: "metadata_missing",
    message: "문서·기준의 버전, 상태, 접근 또는 적용 범위가 미확인입니다. 판정을 시작하지 않습니다.",
  } };
  if (snapshots(input).some((item) => item.state !== "current")) return { ok: false, failure: {
    status: "stopped", judgment: null, code: "not_current",
    message: "대체·보호 문서를 현행 제작용으로 사용할 수 없습니다. 현재 문서를 확인하세요.",
  } };
  return { ok: true, input };
}

// An exact in-memory comparison key, not a cryptographic audit fingerprint.
export function mockInputSignature(input: MockInput): string {
  return JSON.stringify(mockInputSchema.parse(input));
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function runMockJudgment(value: unknown, options: { id: string; at: string; failure?: MockFailure }): RunResult {
  const validated = validateMockInput(value);
  if (!validated.ok) return validated.failure;
  if (!id.safeParse(options.id).success || !z.string().datetime().safeParse(options.at).success) {
    return { status: "stopped", judgment: null, code: "invalid_input", message: "모의 실행 식별값을 확인하세요." };
  }
  if (options.failure) return { status: "failed", judgment: null, code: options.failure, message: failureMessages[options.failure] };
  const input = validated.input;
  const statuses = new Set(input.checks.map((item) => item.status));
  const external = input.requestedAction !== "review";
  const recipientMismatch = input.authorization.requestedRecipients.some((recipient) => !input.authorization.authorizedRecipients.includes(recipient));
  const forbidden = external && (input.authorization.externalAction === "denied" || recipientMismatch);
  const uncertainAuthority = external && input.authorization.externalAction === "unknown";
  const judgment: Judgment = statuses.has("forbidden") || forbidden ? "block"
    : statuses.has("conflict") || uncertainAuthority ? "human_review"
    : statuses.has("missing") ? "hold"
    : statuses.has("revise") ? "revise" : "adopt";
  return freeze({
    status: "succeeded", id: options.id, at: options.at, mode: "mock", judgment,
    summary: summaries[judgment], input, signature: mockInputSignature(input),
    executionAllowed: false, modelCost: null, accuracy: null,
  });
}

export type RunView = { state: "current" | "stale"; run: MockRun } | { state: "unavailable"; message: string };
export function viewMockRun(run: MockRun, current: unknown): RunView {
  const validated = validateMockInput(current);
  if (!validated.ok) return { state: "unavailable", message: validated.failure.message };
  return { state: run.signature === mockInputSignature(validated.input) ? "current" : "stale", run };
}

export type HumanDecision = {
  id: string; runId: string; judgment: Judgment; reason: string; actor: "로컬 테스트 사용자";
  at: string; sourceVersion: number; signature: string; executionAllowed: false;
};
export function recordMockDecision(run: MockRun, current: unknown, value: unknown):
  { ok: true; decision: HumanDecision } | { ok: false; message: string } {
  if (viewMockRun(run, current).state !== "current") return { ok: false, message: "입력 또는 접근 범위가 변경되었습니다. 먼저 재검토하세요." };
  const parsed = z.object({ id, judgment: judgmentSchema, reason: z.string().trim().min(1).max(500), at: z.string().datetime() }).strict().safeParse(value);
  if (!parsed.success) return { ok: false, message: "선택한 판정과 이유(1~500자)를 확인하세요." };
  return { ok: true, decision: freeze({
    ...parsed.data, runId: run.id, actor: "로컬 테스트 사용자", sourceVersion: run.input.source.version!,
    signature: run.signature, executionAllowed: false,
  }) };
}

import { z } from "zod";

const ROUTING_CONFIDENCE_MINIMUM = 0.6;
const canonicalSkillRegistryDocumentId = "c6b7d39d-43aa-4b09-b58d-6cf8a8dd1563";

export type AgentRoute = {
  skillName: string;
  description: string;
  roleKey: string;
  documentId: string;
  documentTitle?: string;
  documentStatus?: string;
  documentFolder?: string;
};

const sensitiveRoutingPatterns = [
  /\b(?:api[-_ ]?key|access[-_ ]?token|password|passwd|secret|authorization)\b\s*[:=]\s*\S+/iu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/iu,
  /\b(?:sk-[A-Za-z0-9]{16,}|bos_pat_[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b\d{6}[- ]?[1-4]\d{6}\b/u,
];

export function hasSensitiveRoutingInput(text: string) {
  return sensitiveRoutingPatterns.some((pattern) => pattern.test(text));
}

export function isAgentRequestRoutingEnabled(environment: Record<string, string | undefined>) {
  return environment.AGENT_REQUEST_ROUTING_ENABLED === "true"
    && environment.VERCEL_ENV !== "production"
    && ["local", "development", "qa"].includes(environment.OS_ENVIRONMENT ?? "");
}

/** Read the current skill-to-role and role-to-document mapping from the canonical OS document. */
export function parseCanonicalAgentRoutes(markdown: string): AgentRoute[] {
  const sections = markdown.split(/^###?\s+/m);
  const routingSection = sections.find((section) => section.startsWith("9-1. 업무 라우팅"));
  const registrySection = sections.find((section) => section.startsWith("9-2. 역할 → 원문 등록부"));
  if (!routingSection || !registrySection) return [];

  const roleDocuments = new Map<string, string>();
  for (const line of registrySection.split("\n")) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([0-9a-f-]{36})`\s*\|/i);
    if (match) roleDocuments.set(match[1], match[2]);
  }

  const routes: AgentRoute[] = [];
  for (const line of routingSection.split("\n")) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/);
    if (!match) continue;
    const documentId = roleDocuments.get(match[3]);
    if (!documentId) continue;
    routes.push({ skillName: match[1], description: match[2].trim(), roleKey: match[3], documentId });
  }
  return routes;
}

const answerSchema = z.object({
  request_type: z.enum(["question", "work_request", "decision_support", "problem_report", "unclear"]),
  route: z.string().min(1),
  missing_information: z.enum(["none", "goal_or_result", "brand_or_business", "scope_or_constraints", "source_or_context", "owner_or_approval", "conflicting_instructions", "unknown"]),
  handoff: z.enum(["none", "ambiguous_request", "conflicting_rules", "sensitive_information", "external_or_irreversible_action", "high_impact_decision", "no_matching_route", "unconfirmed_reference"]),
}).strict();

export type AgentRoutingAdvice = {
  requestType: z.infer<typeof answerSchema>["request_type"];
  route: AgentRoute | null;
  missingInformation: z.infer<typeof answerSchema>["missing_information"];
  handoff: z.infer<typeof answerSchema>["handoff"];
  rationale: string;
  confidence: number | null;
  advisoryOnly: true;
  executionAllowed: false;
  toolPermissionsGranted: false;
  externalMessagesAllowed: false;
  fileOrDatabaseWritesAllowed: false;
  paymentsOrAdsAllowed: false;
  actionTaken: false;
  permissionsChanged: false;
};

/** Call the advisory classifier only after the caller explicitly confirms external processing. */
export async function classifyAgentRequest(
  requestText: string,
  routes: AgentRoute[],
  fetcher: typeof fetch = fetch,
  apiKey = process.env.TYPESAFE_API_KEY,
): Promise<AgentRoutingAdvice> {
  if (!apiKey) throw new Error("JEV 요청 분류가 설정되지 않았습니다.");
  if (routes.length === 0) throw new Error("현재 OS 에이전트 라우팅 기준을 확인하지 못했습니다.");

  const routeChoices = Object.fromEntries([
    ...routes.map((route) => [route.roleKey, `${route.skillName}: ${route.description}; 기준 문서 ${route.documentTitle ?? route.documentId}; 상태 ${route.documentStatus ?? "미확인"}`]),
    ["no_matching_route", "등록된 담당 절차를 확신 있게 고르기 어려움"],
  ]);
  const response = await fetcher("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(4_000),
    body: JSON.stringify({
      state: requestText,
      model: "jev-latest",
      questions: {
        request_type: {
          type: "choice",
          instructions: "요청의 주된 성격을 분류하세요. 애매하면 unclear를 고르세요.",
          criteria: {
            question: "회사 기준이나 현재 상태에 대한 질문",
            work_request: "자료 작성·수정·업무 수행 요청",
            decision_support: "사람의 판단을 돕는 비교·검토 요청",
            problem_report: "오류·불편·문제 해결 요청",
            unclear: "요청 목표를 분명히 알 수 없음",
          },
        },
        route: {
          type: "choice",
          instructions: "현재 OS 에이전트 업무 라우팅 표에서 가장 잘 맞는 하나를 추천하세요. 기준 문서 상태가 canonical이 아니거나 미확인이면 no_matching_route를 고르세요. 두 개 이상 비슷하거나 근거가 약해도 no_matching_route를 고르세요.",
          criteria: routeChoices,
        },
        missing_information: {
          type: "choice",
          instructions: "요청을 담당 절차에 넘기기 전에 꼭 필요한데 빠진 정보 하나를 고르세요. 없으면 none.",
          criteria: {
            none: "담당 절차를 제안하기에 필수 정보가 충분함",
            goal_or_result: "원하는 목표나 완료 결과",
            brand_or_business: "대상 브랜드 또는 사업",
            scope_or_constraints: "이번 작업의 범위나 금지 조건",
            source_or_context: "검토할 자료나 현재 맥락",
            owner_or_approval: "사람 담당자나 필요한 승인자",
            conflicting_instructions: "서로 맞지 않는 지시",
            unknown: "빠진 정보를 특정할 수 없음",
          },
        },
        handoff: {
          type: "choice",
          instructions: "사람에게 넘겨야 할 조건이 요청에 보이는지 고르세요. 실행 허용 여부를 판단하지 마세요.",
          criteria: {
            none: "사람의 추가 확인이 당장 필요하다는 신호가 없음",
            ambiguous_request: "목표나 대상이 모호함",
            conflicting_rules: "요청과 기준이 충돌함",
            sensitive_information: "민감 정보가 포함되었거나 포함될 수 있음",
            external_or_irreversible_action: "외부 발송, 파일·DB 변경, 결제, 광고 집행 등 실행이 언급됨",
            high_impact_decision: "사람이 책임져야 하는 고영향 결정",
            no_matching_route: "확인된 담당 절차가 없음",
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error("JEV가 요청 분류 의견을 반환하지 않았습니다.");
  const payload = await response.json() as {
    answers?: Record<string, { type?: string; choice?: string; confidence?: number; text?: string }>;
  };
  const answers = payload.answers ?? {};
  const parsed = answerSchema.safeParse({
    request_type: answers.request_type?.choice,
    route: answers.route?.choice,
    missing_information: answers.missing_information?.choice,
    handoff: answers.handoff?.choice,
  });
  if (!parsed.success) throw new Error("JEV 응답이 요청 분류 형식에 맞지 않습니다.");

  const selectedRoute = routes.find((route) => route.roleKey === parsed.data.route) ?? null;
  const confidences = ["request_type", "route", "missing_information", "handoff"]
    .map((key) => answers[key]?.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const confidence = confidences.length === 4 ? Math.min(...confidences) : null;
  const uncertain = confidence === null || confidence < ROUTING_CONFIDENCE_MINIMUM;
  const unconfirmedReference = Boolean(selectedRoute && selectedRoute.documentStatus !== "canonical");
  const handoff = unconfirmedReference
    ? "unconfirmed_reference"
    : !selectedRoute || parsed.data.handoff !== "none" || uncertain
      ? (parsed.data.handoff === "none" ? (selectedRoute ? "ambiguous_request" : "no_matching_route") : parsed.data.handoff)
      : "none";

  return {
    requestType: parsed.data.request_type,
    route: selectedRoute,
    missingInformation: uncertain && parsed.data.missing_information === "none" ? "unknown" : parsed.data.missing_information,
    handoff,
    rationale: selectedRoute
      ? unconfirmedReference
        ? `${selectedRoute.documentTitle ?? selectedRoute.documentId} 문서는 ${selectedRoute.documentStatus ?? "상태 미확인"} 상태입니다. 회사 기준으로 적용하지 말고 사람에게 넘겨 주세요.`
        : `현재 OS 업무 라우팅 표에서 ${selectedRoute.skillName}을 첫 담당으로 제안했습니다. 담당 절차를 직접 확인해 주세요.`
      : "현재 OS 업무 라우팅 표에서 적용할 담당 절차를 확인하지 못했습니다.",
    confidence,
    advisoryOnly: true,
    executionAllowed: false,
    toolPermissionsGranted: false,
    externalMessagesAllowed: false,
    fileOrDatabaseWritesAllowed: false,
    paymentsOrAdsAllowed: false,
    actionTaken: false,
    permissionsChanged: false,
  };
}

export { canonicalSkillRegistryDocumentId };

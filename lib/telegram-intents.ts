export type CaptureKind = "review" | "thumbnail" | "raw" | "inbox" | "summary" | "question";

const CAPTURE_KIND_CRITERIA: Record<CaptureKind, string> = {
  review: "상품 후기·구매 경험을 기록해 달라는 요청",
  thumbnail: "유튜브 썸네일 문구·구성·선택 근거를 기록해 달라는 요청",
  raw: "분류 없이 폰 캡처·스크린샷을 그냥 저장해 달라는 요청",
  inbox: "나중에 참고할 아이디어나 메모를 인박스에 저장해 달라는 요청",
  summary: "특정 URL의 내용을 요약해 달라는 요청",
  question: "저장 요청이 아니라 회사 지식이나 운영 현황을 묻는 일반 질문",
};

// Exact prefix commands. This is the original, sole classifier before this
// change and it always takes priority — existing user habits and automation
// are completely unaffected by the optional AI fallback added below.
export function captureKindExact(text: string): CaptureKind {
  if (/^\/?후기(?=\s|$)/u.test(text)) return "review";
  if (/^\/?썸네일기록(?=\s|$)/u.test(text)) return "thumbnail";
  if (/^#raw(?=\s|$)/iu.test(text)) return "raw";
  if (/^[/#]?인박스(?=\s|$)/u.test(text)) return "inbox";
  if (/^\/?요약(?=\s|$)/u.test(text)) return "summary";
  return "question";
}

const TYPESAFE_CONFIDENCE_THRESHOLD = 0.6;

// Optional fallback: classify free-form text that doesn't match any known
// command prefix, using TypeSafe AI's Jev model (a "Choice" structured
// decision — see https://docs.typesafe.ai/introduction). This only fires
// when TYPESAFE_API_KEY is configured and always fails open to "question"
// (today's existing behavior) on missing key, low confidence, timeout, or
// any request error, so it can never break or block the existing capture
// flow — it can only additionally catch messages that used to be
// misclassified as "question" (and dropped into knowledge search) despite
// clearly asking to be saved.
async function classifyCaptureKindWithTypeSafe(text: string): Promise<CaptureKind | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || !text.trim()) return null;
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4_000),
      body: JSON.stringify({
        state: text,
        model: "jev-latest",
        questions: {
          capture_kind: {
            type: "choice",
            instructions: "이 텔레그램 메시지가 어떤 저장 요청에 가장 가까운지 판정하세요. 정해진 명령어 접두사(#인박스, /후기, /썸네일기록, #raw, /요약)가 없는 자유 문장을 분류하는 용도입니다.",
            criteria: CAPTURE_KIND_CRITERIA,
          },
        },
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { answers?: { capture_kind?: { type: string; choice?: string; confidence?: number } } };
    const answer = body.answers?.capture_kind;
    if (!answer || answer.type !== "choice" || !answer.choice) return null;
    if ((answer.confidence ?? 0) < TYPESAFE_CONFIDENCE_THRESHOLD) return null;
    if (!(answer.choice in CAPTURE_KIND_CRITERIA)) return null;
    return answer.choice as CaptureKind;
  } catch {
    return null;
  }
}

export async function captureKind(text: string): Promise<CaptureKind> {
  const exact = captureKindExact(text);
  if (exact !== "question") return exact;
  const aiKind = await classifyCaptureKindWithTypeSafe(text);
  return aiKind ?? "question";
}

export function isBotAddressed(message: { chat: { type: string }; text?: string; caption?: string; reply_to_message?: { from?: { is_bot?: boolean; username?: string } } }, configuredUsername: string | undefined) {
  if (message.chat.type === "private") return true;
  const username = configuredUsername?.replace(/^@/, "").toLowerCase();
  if (!username) return false;
  const mentions = (message.text ?? message.caption ?? "").match(/@[A-Za-z0-9_]+/g) ?? [];
  return mentions.some((mention) => mention.slice(1).toLowerCase() === username)
    || Boolean(message.reply_to_message?.from?.is_bot && message.reply_to_message.from.username?.toLowerCase() === username);
}

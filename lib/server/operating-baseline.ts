import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { jsonText } from "./meeting-summary";

// "운영 기준" 재작성 — 옛 사내 봇(brandyaction-bot)의 /운영안 프롬프트를 그대로 옮긴
// 것. 회의 결정(운영안 원문)들을 카테고리별로 묶고 출처 번호⟨n⟩를 붙이고, 미결·충돌을
// 따로 정리한다. 실패하면 null을 돌려주고, 호출자는 운영안 원문 저장은 그대로 두고
// 재작성만 건너뛴다 — 원본이 사라지는 일은 없다.

const SUMMARY_SYSTEM = `당신은 BRANDYACTION 운영 문서를 읽고 '지금 유효한 운영 기준'을 정리하는 사람입니다.
문서마다 [n] 같은 번호가 붙어 있습니다. 출처는 그 번호로만 표기하세요.
같은 사안을 다룬 문서가 여러 개면 날짜가 늦은 것이 최신입니다.

출력 형식 — 이 틀만 쓰세요.

[묶음이름]
- 결정 내용 ⟨1⟩
- 결정 내용 ⟨1,2⟩

[다른 묶음이름]
- ...

❓ 아직 안 정해진 것
- 미결 사항 ⟨3⟩

⚠️ 서로 어긋나는 것
- A는 X, B는 Y — 최신은 무엇

규칙:
- 묶음은 3~6개. 이름은 두세 글자 명사로 (예: 광고, 콘텐츠, 채널운영).
- 한 줄은 60자 이내. 길면 잘라 쓰되 숫자·날짜·기준은 원문 그대로.
- 여러 문서가 같은 말을 하면 한 줄로 합치고 출처만 ⟨1,2⟩처럼 묶는다. 절대 반복하지 마라.
- 굵게(**), 밑줄(_), 백틱(\`), 표, 머리글(#) 금지. 화면에 기호가 그대로 보인다.
- 강조가 필요하면 따옴표만 쓴다.
- 문서에 없는 내용을 지어내지 마라. 근거가 없으면 그 항목을 아예 빼라.
- 어긋나는 게 없으면 '⚠️ 서로 어긋나는 것' 아래 '- 없음' 한 줄만.
- 해석·조언·제안 금지. 문서에 적힌 것을 옮기고 충돌만 짚는다.`;

const UPDATE_SYSTEM = `당신은 BRANDYACTION의 '지금 유효한 운영 기준' 문서를 고쳐 쓰는 사람입니다.
기존 기준 한 장과, 그 뒤에 새로 들어온 운영 문서가 주어집니다.

할 일:
- 새 문서가 뒤집은 항목은 새 내용으로 바꾼다.
- 새 문서가 건드리지 않은 항목은 글자 그대로 남긴다. 다시 쓰거나 다듬지 마라.
- 새 문서에만 있는 내용은 알맞은 묶음에 더한다.
- 새 문서가 '아직 안 정해진 것'을 정했으면 그 줄을 위로 옮긴다.
- 기존과 새 문서가 어긋나면 새 것을 따르되 '⚠️ 서로 어긋나는 것'에 남긴다.

출력은 고쳐 쓴 기준 전문. 형식·묶음·⟨번호⟩ 표기는 기존 것을 그대로 따른다.
출처 번호는 주어진 번호만 쓴다. 새로 매기지 마라.
굵게(**)·백틱(\`)·표·머리글(#) 금지. 설명·머리말 없이 기준 본문만 출력.`;

function stripMarkMarks(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "'$1'").replace(/^#+\s*/gm, "").trim();
}

export interface OpsSourceDoc { number: number; title: string; content: string }

export async function synthesizeOperatingBaseline(
  businessLabel: string,
  newDocs: OpsSourceDoc[],
  existingBody: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !newDocs.length) return null;
  const blocks = newDocs.map((doc) => `# [${doc.number}] ${doc.title}\n${doc.content.slice(0, 12_000)}`).join("\n\n---\n\n");
  const system = existingBody ? UPDATE_SYSTEM : SUMMARY_SYSTEM;
  const user = existingBody
    ? `# 사업: ${businessLabel}\n\n# 기존 기준\n${existingBody}\n\n# 새로 들어온 문서\n\n${blocks}`
    : `# 사업: ${businessLabel}\n\n${blocks}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OPENAI_ANSWER_MODEL, instructions: system, input: user, max_output_tokens: 2000 }),
      signal: controller.signal,
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) return null;
    const text = jsonText(result);
    return text ? stripMarkMarks(text) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

import { z } from "zod";
import { FORMAT_TEST_FORMATS, type WarehouseFormatId } from "./format-test-renderer.mjs";

const label = (max: number) => z.string().trim().min(1).max(max).refine(
  value => !/[\u0000-\u001f\u007f]/u.test(value),
  "한 줄로 입력해 주세요.",
);
export const formatTestCopy = z.object({
  brand: label(15), headline: label(54), support: label(60), cta: label(20),
}).strict();
const followup = z.object({
  baseId: z.string().uuid(),
  formatId: z.custom<WarehouseFormatId>(id => FORMAT_TEST_FORMATS.some(format => format.id === id)),
  mode: z.enum(["appeal", "copy", "image"]),
}).strict();
export const formatTestInput = z.object({
  appeal: label(160), copy: formatTestCopy, assetPath: z.string().min(1).max(200).optional(),
  followup: followup.optional(),
  renderVersion: z.union([z.literal(1), z.literal(2)]).optional(),
}).strict();
export type FormatTestInput = z.infer<typeof formatTestInput>;
export interface FormatTestRun extends FormatTestInput {
  id: string;
  createdAt: string;
  version: 1;
}

export const MYIN_FORMAT_TEST: FormatTestInput = {
  renderVersion: 2,
  appeal: "지원할 공고는 쌓이는데 어떤 일이 내게 맞을지 고르기 어렵다.",
  copy: {
    brand: "마이인", headline: "저장한 공고는 많은데, 어디에 지원하지?",
    support: "내 강점에서 일 고르는 기준을 찾아보세요.", cta: "무료 진단 시작하기",
  },
};

// A run stores a single copy and appeal for all five formats. Art direction and
// the shared photo belong to this version of the renderer, not to each variant.
export function addFormatTest(history: FormatTestRun[] | undefined, id: string, input: FormatTestInput, now: string) {
  const value = formatTestInput.parse(input);
  const runs = history || [];
  if (value.followup) {
    const spec = value.followup;
    const base = runs.find(run => run.id === spec.baseId);
    if (!base || (base.followup && base.followup.formatId !== spec.formatId))
      throw new Error("저장된 기준 묶음에서 같은 포맷을 골라 주세요.");
    if ((base.renderVersion ?? 1) !== (value.renderVersion ?? 1))
      throw new Error("후속 시안에는 기준 묶음과 같은 디자인 버전을 사용해 주세요.");
    if (base.copy.brand !== value.copy.brand || base.copy.cta !== value.copy.cta)
      throw new Error("후속 테스트에서는 브랜드와 CTA를 유지해 주세요.");
    const changedText = value.copy.headline !== base.copy.headline || value.copy.support !== base.copy.support;
    const changedImage = value.assetPath !== base.assetPath;
    const changedAppeal = value.appeal !== base.appeal;
    if (spec.mode === "appeal" && (!changedAppeal || !changedText || changedImage))
      throw new Error("소구 테스트는 사진을 두고 다른 소구와 그 이유를 담은 문구를 입력해 주세요.");
    if (spec.mode === "copy" && (changedAppeal || !changedText || changedImage))
      throw new Error("카피 테스트는 같은 소구와 사진에서 제목이나 설명을 바꿔 주세요.");
    if (spec.mode === "image" && (changedAppeal || changedText || !changedImage))
      throw new Error("이미지 테스트는 소구와 문구를 두고 다른 사진을 골라 주세요.");
  }
  const previous = runs.find(run => run.id === id);
  if (previous) {
    if ((previous.renderVersion ?? 1) !== (value.renderVersion ?? 1) || JSON.stringify(previous.followup) !== JSON.stringify(value.followup) || previous.assetPath !== value.assetPath || previous.appeal !== value.appeal || Object.keys(value.copy).some(
      key => previous.copy[key as keyof typeof value.copy] !== value.copy[key as keyof typeof value.copy],
    )) throw new Error("같은 묶음 ID에 다른 입력이 들어왔어요.");
    return runs;
  }
  return [...runs, { id, createdAt: now, version: 1 as const, ...value }];
}

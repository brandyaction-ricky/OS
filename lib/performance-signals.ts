export type PerformanceSignalTone = "danger" | "positive" | "neutral";

export interface PerformanceSignal {
  tone: PerformanceSignalTone;
  label: string;
  detail: string;
}

function percentageChange(current: number, reference: number) {
  return reference ? ((current - reference) / Math.abs(reference)) * 100 : null;
}

export function buildPerformanceSignal(input: {
  title: string;
  current: number;
  previous: number;
  target?: number | null;
  unit?: string;
}): PerformanceSignal {
  const { title, current, previous, target = null, unit = "" } = input;
  const conversionMetric = /전환|클릭률|ctr|cvr/i.test(title) || unit.includes("%");
  const weeklyThreshold = conversionMetric ? 20 : 10;

  if (current === 0 && previous === 0) {
    return { tone: "danger", label: "2주 연속 0", detail: "입력 누락 또는 성과 중단 여부를 확인하세요." };
  }

  if (typeof target === "number" && Number.isFinite(target) && target !== 0) {
    const targetGap = percentageChange(current, target) ?? 0;
    if (Math.abs(targetGap) >= 10) {
      return {
        tone: targetGap < 0 ? "danger" : "positive",
        label: `목표 ${targetGap > 0 ? "+" : ""}${targetGap.toFixed(1)}%`,
        detail: targetGap < 0 ? "목표 대비 10% 이상 낮습니다." : "목표 대비 10% 이상 높습니다.",
      };
    }
  }

  const weeklyChange = percentageChange(current, previous);
  if (weeklyChange !== null && Math.abs(weeklyChange) >= weeklyThreshold) {
    return {
      tone: weeklyChange < 0 ? "danger" : "positive",
      label: `${weeklyChange > 0 ? "+" : ""}${weeklyChange.toFixed(1)}%`,
      detail: `${conversionMetric ? "전환" : "성과"} 지표가 전주 대비 ${weeklyThreshold}% 이상 변했습니다.`,
    };
  }

  return { tone: "neutral", label: "정상 범위", detail: "설정된 경고 기준 안에 있습니다." };
}

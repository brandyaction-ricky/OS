// Deployment-specific destinations: prototype filenames are not application routes.
export const CONTENTS_AUTO_SCREENS = [
  ["dashboard", "대시보드"],
  ["review", "최종 점검"],
  ["requests", "Claude 요청함"],
  ["library", "라이브러리"],
  ["calendar", "발행 캘린더"],
  ["performance", "성과 기록"],
  ["templates", "카드뉴스 시안"],
  ["settings", "자동화 설정"],
] as const;
export type ContentsAutoScreen = typeof CONTENTS_AUTO_SCREENS[number][0];

export function contentsAutoLinks(raw: string | undefined): Partial<Record<ContentsAutoScreen, string>> {
  if (!raw?.trim()) return {};
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return Object.fromEntries(CONTENTS_AUTO_SCREENS.flatMap(([key]) => {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value !== "string") return [];
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return [];
        return [[key, url.href]];
      } catch { return []; }
    }));
  } catch { return {}; }
}

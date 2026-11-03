// 사진 후보 (유쓰 요청 2/8 보완, 2026-11-03): one Unsplash or 위키미디어 search result as the 사진 칸 shows it — the source's own thumbnail
// (its API terms ask for hotlinking), the author and the license, and whether someone must check the license before using it.

export interface MyinPhotoCandidate {
  provider: "unsplash" | "wikimedia"; id: string; thumb: string; width: number; height: number;
  author: string; authorPage: string | null; page: string; license: string;
  /** The license asks for more than a credit line (share-alike, or none given): someone checks before using it. */
  check: boolean;
}

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REF = "utm_source=brandyaction_os&utm_medium=referral";   // Unsplash attribution links (API guidelines)
const withRef = (url: string) => `${url}${url.includes("?") ? "&" : "?"}${REF}`;
const strip = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

export type UnsplashPhoto = { id: string; width: number; height: number; urls: { small: string; raw: string }; links: { html: string; download_location: string };
  user: { name: string; links: { html: string } } };
export const fromUnsplash = (p: UnsplashPhoto): MyinPhotoCandidate => ({ provider: "unsplash", id: p.id, thumb: p.urls.small, width: p.width, height: p.height,
  author: p.user.name, authorPage: withRef(p.user.links.html), page: withRef(p.links.html), license: "Unsplash 라이선스", check: false });

export type WikiPage = { title: string; index?: number; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; mime: string; width: number; height: number;
  extmetadata?: Record<string, { value?: string }> }[] };
export function fromWikimedia(page: WikiPage): MyinPhotoCandidate | null {
  const info = page.imageinfo?.[0];
  if (!info || !PHOTO_TYPES.has(info.mime)) return null;
  const meta = info.extmetadata ?? {};
  const license = strip(meta.LicenseShortName?.value ?? "") || "사용 조건 확인 필요";
  return { provider: "wikimedia", id: page.title, thumb: info.thumburl ?? info.url, width: info.width, height: info.height,
    author: strip(meta.Artist?.value ?? "") || "작가 표기 확인 필요", authorPage: null, page: info.descriptionurl, license,
    check: !/^(cc0|public domain|pd\b|cc by \d|cc-by-\d|cc by$)/i.test(license) };
}

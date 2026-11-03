import { ApiError } from "@/lib/http";
import type { RequestActor } from "@/lib/server/auth";
import { fromUnsplash, fromWikimedia, PHOTO_TYPES as TYPES, type MyinPhotoCandidate, type UnsplashPhoto, type WikiPage } from "@/lib/myin-photo-sources";
import { myinOurImageUpload, saveMyinOurImage } from "@/lib/server/myin-run";

// 사진 후보 찾기 (유쓰 요청 2/8 보완, 2026-11-03 · 대표: Unsplash + 위키미디어, 0원): candidates for one photo file of a v13 run from the
// two sources the storyboard rule allows. Looking costs nothing and changes nothing. [사용하기] looks the photo up again by its id (never
// an address the browser sent), keeps it as the run's image for that file with its credit, and tells Unsplash of the download.

const UA = "BrandyActionOS/1.0 (https://brandyaction-os.vercel.app)";
// thumb.wikimedia.org: where Commons serves its resized copies (2026-11: a 2400 px thumbnail of a larger original).
const IMAGE_HOSTS = new Set(["images.unsplash.com", "upload.wikimedia.org", "thumb.wikimedia.org"]);
const MAX_BYTES = 20 * 1024 * 1024;
const unsplashKey = () => process.env.UNSPLASH_ACCESS_KEY?.trim() ?? "";

async function getJson(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new ApiError(502, "MYIN_PHOTO_SOURCE_FAILED", `사진 후보를 가져오지 못했어요 (${response.status}).`);
  return response.json() as Promise<Record<string, unknown>>;
}

const wikiQuery = (params: Record<string, string>) => getJson(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json",
  prop: "imageinfo", iiprop: "url|extmetadata|mime|size", ...params })}`, {});

/** Up to six of each source for the words given; a source that fails or has no key is left out and named. */
export async function findMyinPhotoCandidates(query: string) {
  const words = query.trim().slice(0, 100);
  if (!words) throw new ApiError(400, "MYIN_PHOTO_QUERY", "찾을 말을 적어 주세요.");
  const missing: string[] = [];
  const [unsplash, wikimedia] = await Promise.all([
    unsplashKey() ? getJson(`https://api.unsplash.com/search/photos?${new URLSearchParams({ query: words, per_page: "6", orientation: "landscape", content_filter: "high" })}`,
      { authorization: `Client-ID ${unsplashKey()}`, "accept-version": "v1" })
      .then((page) => ((page.results ?? []) as UnsplashPhoto[]).map(fromUnsplash), () => { missing.push("Unsplash"); return []; })
      : (missing.push("Unsplash (키 연결 전)"), Promise.resolve([])),
    wikiQuery({ generator: "search", gsrsearch: `${words} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "8", iiurlwidth: "640" })
      .then((page) => Object.values(((page.query as { pages?: Record<string, WikiPage> })?.pages) ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(fromWikimedia).filter((c): c is MyinPhotoCandidate => Boolean(c)).slice(0, 6), () => { missing.push("위키미디어"); return []; }),
  ]);
  return { candidates: [...unsplash, ...wikimedia], missing };
}

/** The chosen candidate, looked up again by id: the address to fetch (2400 px wide) and its credit line. */
async function resolve(provider: "unsplash" | "wikimedia", id: string) {
  if (provider === "unsplash") {
    if (!unsplashKey()) throw new ApiError(409, "MYIN_PHOTO_SOURCE_OFF", "Unsplash 키가 아직 연결되지 않았어요.");
    const auth = { authorization: `Client-ID ${unsplashKey()}`, "accept-version": "v1" };
    const photo = await getJson(`https://api.unsplash.com/photos/${encodeURIComponent(id)}`, auth) as unknown as UnsplashPhoto;
    // Unsplash API terms: tell them of each download (their counter only; the photo itself comes from urls.raw).
    await getJson(photo.links.download_location, auth).catch(() => undefined);
    return { url: `${photo.urls.raw}&w=2400&fm=jpg&q=85`, credit: { source: `Unsplash · ${photo.user.name}`, license: "Unsplash 라이선스", url: photo.links.html } };
  }
  const page = await wikiQuery({ titles: id, iiurlwidth: "2400" });
  const found = Object.values(((page.query as { pages?: Record<string, WikiPage> })?.pages) ?? {})[0];
  const candidate = found ? fromWikimedia(found) : null;
  const info = found?.imageinfo?.[0];
  if (!candidate || !info) throw new ApiError(404, "MYIN_PHOTO_NOT_FOUND", "그 사진을 다시 찾지 못했어요.");
  return { url: info.thumburl ?? info.url, credit: { source: `위키미디어 공용 · ${candidate.author}`, license: candidate.license, url: candidate.page } };
}

/** [사용하기]: the photo becomes this run's image for `file` (as an uploaded 우리 이미지 would, with its credit kept). */
export async function applyMyinPhotoCandidate(actor: RequestActor, runId: string, file: string, provider: "unsplash" | "wikimedia", id: string) {
  const { url, credit } = await resolve(provider, id);
  if (!IMAGE_HOSTS.has(new URL(url).hostname)) throw new ApiError(400, "MYIN_PHOTO_SOURCE", "Unsplash · 위키미디어 사진만 쓸 수 있어요.");
  const response = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!response.ok || !TYPES.has(type)) throw new ApiError(502, "MYIN_PHOTO_DOWNLOAD", "사진을 받지 못했어요. 다른 후보를 골라 주세요.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new ApiError(400, "MYIN_OUR_IMAGE_SIZE", "20MB가 넘는 사진이에요. 다른 후보를 골라 주세요.");
  const { path, uploadUrl } = await myinOurImageUpload(actor, runId, file, type);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": type, "x-upsert": "true" }, body: bytes });
  if (!put.ok) throw new ApiError(502, "MYIN_PHOTO_UPLOAD", "사진을 OS에 넣지 못했어요. 다시 해 주세요.");
  return saveMyinOurImage(actor, runId, file, path, credit);
}

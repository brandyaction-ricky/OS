/** Admin shortcuts must be HTTPS destinations, not public content sharing links. */
export function commerceAdminUrlError(value: string | null | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return "HTTPS 관리자 주소를 입력해 주세요.";
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (["youtube.com", "youtu.be", "instagram.com", "tiktok.com"].some(domain => host === domain || host.endsWith(`.${domain}`))) {
      return "콘텐츠 공유 주소입니다. 실제 관리자 사이트 주소를 입력해 주세요.";
    }
    return null;
  } catch {
    return "올바른 HTTPS 관리자 주소를 입력해 주세요.";
  }
}

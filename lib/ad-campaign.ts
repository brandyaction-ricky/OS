/** Both creative formats use the video project's stable campaign ID. */
export function campaignTrackingUrl(landing: string, campaignId: string, medium: "video" | "image", aspect?: "9x16" | "4x5" | "1x1") {
  try {
    const url = new URL(landing);
    if (url.protocol !== "https:" || url.username || url.password || !campaignId) return "";
    url.searchParams.set("utm_source", "meta");
    url.searchParams.set("utm_medium", "paid_social");
    url.searchParams.set("utm_campaign", campaignId);
    url.searchParams.set("utm_content", aspect ? (medium === "video" ? "v" : "i") + aspect : medium);
    return url.toString();
  } catch { return ""; }
}

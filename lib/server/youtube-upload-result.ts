import { createHash } from "node:crypto";

// The primary key makes concurrent completion retries converge without a new DB constraint.
export function youtubeUploadRecordId(channelId: string, videoId: string) {
  const hash = createHash("sha256").update(`os:youtube-upload:${channelId}:${videoId}`).digest("hex");
  const variant = ((Number.parseInt(hash[16], 16) & 3) | 8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function youtubeUploadPublication(privacyStatus: string | undefined) {
  if (privacyStatus === "public") return { status: "published", stage: "YouTube 공개", publicationState: "published" };
  return {
    status: "ready",
    stage: privacyStatus === "unlisted" ? "일부공개 업로드" : "비공개 업로드",
    publicationState: "uploaded",
  };
}

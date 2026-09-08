export interface PendingYoutubeCompletion {
  kitId: string;
  videoId: string;
  privacyStatus: "private" | "unlisted";
  finalApproval: true;
}

export async function finalizeYoutubeUpload<T>(options: {
  kitId: string;
  privacyStatus: "private" | "unlisted";
  pending: PendingYoutubeCompletion | null;
  upload: () => Promise<{ id: string }>;
  complete: (input: PendingYoutubeCompletion) => Promise<T>;
  remember: (pending: PendingYoutubeCompletion | null) => void;
}) {
  if (options.pending && options.pending.kitId !== options.kitId) throw new Error("선택한 키트와 업로드 결과가 다릅니다.");
  let pending = options.pending;
  if (!pending) {
    const video = await options.upload();
    pending = { kitId: options.kitId, videoId: video.id, privacyStatus: options.privacyStatus, finalApproval: true };
    // Keep the video identity before making another network request. A retry must not resend bytes.
    options.remember(pending);
  }
  const result = await options.complete(pending);
  options.remember(null);
  return result;
}

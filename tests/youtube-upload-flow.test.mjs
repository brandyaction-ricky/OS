import assert from "node:assert/strict";
import test from "node:test";
import { finalizeYoutubeUpload } from "../lib/youtube-upload-flow.ts";

test("failed OS confirmation retries the existing video without creating another upload session", async () => {
  let pending = null, uploads = 0, completions = 0;
  const options = {
    kitId: "kit", privacyStatus: "private",
    upload: async () => { uploads += 1; return { id: "video" }; },
    complete: async (input) => {
      completions += 1;
      assert.equal(input.videoId, "video");
      assert.equal(input.privacyStatus, "private");
      if (completions === 1) throw new Error("OS record unavailable");
      return { videoUrl: "https://youtube.example/video" };
    },
    remember: (value) => { pending = value; },
  };
  await assert.rejects(finalizeYoutubeUpload({ ...options, pending }), /OS record unavailable/);
  assert.equal(pending.videoId, "video");
  const result = await finalizeYoutubeUpload({ ...options, privacyStatus: "unlisted", pending });
  assert.equal(result.videoUrl, "https://youtube.example/video");
  assert.equal(uploads, 1);
  assert.equal(completions, 2);
  assert.equal(pending, null);
});

test("an upload failure never creates a pending completion or calls OS confirmation", async () => {
  let remembered = false, confirmed = false;
  await assert.rejects(finalizeYoutubeUpload({ kitId: "kit", privacyStatus: "private", pending: null,
    upload: async () => { throw new Error("network failed"); },
    complete: async () => { confirmed = true; }, remember: () => { remembered = true; },
  }), /network failed/);
  assert.equal(remembered, false);
  assert.equal(confirmed, false);
});

test("pending uploads cannot accidentally be confirmed against another content kit", async () => {
  let called = false;
  await assert.rejects(finalizeYoutubeUpload({ kitId: "new-kit", privacyStatus: "private",
    pending: { kitId: "old-kit", videoId: "video", privacyStatus: "private", finalApproval: true },
    upload: async () => { called = true; return { id: "wrong" }; },
    complete: async () => { called = true; }, remember: () => {},
  }), /선택한 키트/);
  assert.equal(called, false);
});

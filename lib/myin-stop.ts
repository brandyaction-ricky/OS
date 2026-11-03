// 멈춘 곳부터 다시 하기 (유쓰 요청 3/8, 2026-11-02): what a v13 run's stop code means in plain words, whether pressing again can help,
// and what the existing 다시 하기 button redoes and keeps. The run keeps every finished step; a changed 원고 is a new run (MYIN_RUN_STALE).
type Stop = { why: string; again: boolean; next?: string };
const NETWORK: Stop = { why: "OS 저장소와 주고받다 잠깐 끊겼어요.", again: true };
const LOST: Stop = { why: "영상 만드는 컴퓨터가 만든 결과 파일이 OS에 들어오지 않았어요.", again: true };
export const MYIN_STOPS: Record<string, Stop> = {
  WORKER_STAGE_FAILED: { why: "영상 만드는 컴퓨터의 프로그램이 도중에 멈췄어요. 다시 해도 같은 이유로 멈출 수 있어요.", again: false },
  WORKER_RENDER_FAILED: { why: "영상 만드는 컴퓨터에서 이유가 남지 않은 채 멈췄어요.", again: true },
  WORKER_DOWNLOAD_FAILED: { why: "영상 만드는 컴퓨터가 사진이나 음성 파일을 받지 못했어요. 사진 주소를 확인해 주세요.", again: true },
  WORKER_UPLOAD_FAILED: { why: "영상 만드는 컴퓨터가 결과를 OS에 올리다 실패했어요.", again: true },
  WORKER_UPLOAD_NETWORK: { why: "영상 만드는 컴퓨터가 결과를 올리는 중에 인터넷이 끊겼어요.", again: true },
  WORKER_UPLOAD_TOO_LARGE: { why: "결과 파일이 너무 커서 OS에 올리지 못했어요.", again: false },
  WORKER_BREATH_FAILED: { why: "숨 자리를 고르는 프로그램이 멈췄어요.", again: true },
  MYIN_RUN_STALE: { why: "원고가 바뀌었어요. v13 음성을 다시 시작해 주세요.", again: false },
  MYIN_PARAGRAPHS_MISMATCH: { why: "영상 만드는 컴퓨터가 읽은 문단이 OS 원고와 달라요.", again: false },
  MYIN_VOICE_KEY_MISSING: { why: "영상 만드는 컴퓨터에 목소리 설정이 없어요.", again: false },
  MYIN_VOICE_MISMATCH: { why: "내 컴퓨터가 받은 음성이 영상 만드는 컴퓨터의 것과 달라요. 영상 만드는 컴퓨터로 보내 주세요.", again: false },
  MYIN_WORK_MISSING: { why: "이 영상을 시작한 작업 폴더가 그 컴퓨터에 없어요.", again: false },
  MYIN_LOUDNESS_UNKNOWN: { why: "완성 영상의 음량 검사가 돌지 않았어요.", again: true },
  MYIN_OUR_IMAGE_NEEDED: { why: "「우리 이미지」로 올려야 하는 사진이 아직 없어요.", again: false,
    next: "아래 「장면 그림 바꾸기 (우리 이미지)」에서 「받을 곳 없음」 사진을 올리면 자료 준비가 저절로 다시 시작돼요." },
  MYIN_PREP_ASSETS: { why: "자동으로 받을 수 없는 사진이 있어요. 「우리 이미지」로 올리거나 기획표를 수정 요청해 주세요.", again: false },
  MYIN_STORYBOARD_MISSING: { why: "기획표 파일을 찾지 못했어요. 기획표를 다시 받아 주세요.", again: false },
  MYIN_VOICE_FAILED: { why: "목소리를 만드는 곳(Fish)에서 실패했어요.", again: true },
  MYIN_CTA_FAILED: { why: "구독 대사 목소리를 만드는 곳(Fish)에서 실패했어요.", again: true },
  MYIN_BUNDLE_MISSING: LOST, MYIN_BUNDLE_INVALID: LOST, MYIN_CLIPS_MISSING: LOST,
  MYIN_SIGN_FAILED: NETWORK, VOICE_STORAGE_UPLOAD_FAILED: NETWORK, MYIN_CLAIM_FAILED: NETWORK, MYIN_PREP_CLAIM_FAILED: NETWORK, MYIN_CLIPS_CLAIM_FAILED: NETWORK, MYIN_FINAL_CLAIM_FAILED: NETWORK,
};

/** Why it stopped and what to do; an unknown code is 확인 필요, never a promise that pressing again fixes it. */
export function myinStop(code: string | null) {
  const stop = code ? MYIN_STOPS[code] : undefined;
  if (!stop) return { why: "멈춘 이유가 분명하지 않아요(확인 필요).", next: "한 번 다시 해 보고, 또 멈추면 OS 담당자에게 알려 주세요." };
  return { why: stop.why, next: stop.next ?? (stop.again ? "다시 하면 이어서 해요. 같은 이유로 또 멈추면 OS 담당자에게 알려 주세요." : "다시 하기 전에 OS 담당자에게 알려 주세요.") };
}

/** What 다시 하기 redoes from a stopped stage, and what it keeps. */
export function myinRetryScope(run: { stage: string; clipsReview?: unknown; prepared?: unknown }) {
  switch (run.stage) {
    case "breath_pending": case "voice_pending": case "words_pending": return "1단계 음성 · 받아쓰기부터 다시 해요. 같은 원고면 이미 만든 문단 음성은 이어 써요.";
    case "cta_pending": return "4단계 구독 대사 음성부터 다시 해요. 이미 만든 대사 음성은 그대로 써요.";
    case "prep_pending": return run.clipsReview ? "4단계 자료 준비부터 다시 해요. 음성 · 기획표 · 미리보기 확인은 그대로 써요." : "3단계 미리보기 준비부터 다시 해요. 음성 · 기획표는 그대로 써요.";
    case "clips_pending": return run.prepared ? "미리보기 영상만 다시 만들어요. 끝난 미리보기 준비(사진 · 선곡 · 점검)는 그대로 써요." : "3단계 미리보기 준비부터 다시 해요. 음성 · 기획표는 그대로 써요.";
    case "final_pending": return "전체 영상 합치기만 다시 해요. 음성 · 기획표 · 미리보기 · 사진 · 사운드는 그대로 써요.";
    default: return "";
  }
}

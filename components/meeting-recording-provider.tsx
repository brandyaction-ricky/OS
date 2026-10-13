"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "./session-provider";
import { transcribeMeeting } from "@/lib/api-client";
import { EMPTY_RECORDING, MeetingRecordingController, type RecordingSnapshot } from "@/lib/knowledge/recording-controller";

type RecordingContextValue = { controller: MeetingRecordingController; snapshot: RecordingSnapshot; demo: boolean };
const RecordingContext = createContext<RecordingContextValue | null>(null);

export function MeetingRecordingProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, session, profile, demo } = useSession();
  const token = useRef(accessToken); token.current = accessToken;
  const [controller] = useState(() => new MeetingRecordingController({
    microphone: () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("MIC_UNAVAILABLE");
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    },
    recorder: stream => {
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      return new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    },
    peer: () => new RTCPeerConnection(),
    negotiate: async (meetingId, sdp, signal) => {
      if (!token.current) throw new Error("AUTH_REQUIRED");
      const response = await fetch(`/api/v1/knowledge/meetings/${encodeURIComponent(meetingId)}/live-transcription`, {
        method: "POST", headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${token.current}` },
        body: sdp, signal, cache: "no-store",
      });
      if (!response.ok) throw new Error("LIVE_TRANSCRIPTION_FAILED");
      return response.text();
    },
    transcribe: async audio => {
      if (!token.current) throw new Error("AUTH_REQUIRED");
      return (await transcribeMeeting(token.current, audio)).transcript;
    },
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, () => EMPTY_RECORDING);
  // Auth refresh keeps the same identity; sign-out/account changes release audio immediately.
  const identity = session?.user.id ?? (demo ? profile?.id : null);
  useEffect(() => { return () => controller.reset(); }, [controller, identity]);
  useEffect(() => {
    if (snapshot.phase === "idle") return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [snapshot.phase]);
  return <RecordingContext.Provider value={{ controller, snapshot, demo }}>
    {children}<RecordingBar />
  </RecordingContext.Provider>;
}

export function useMeetingRecording() {
  const context = useContext(RecordingContext);
  if (!context) throw new Error("MeetingRecordingProvider is required");
  return context;
}

function RecordingBar() {
  const { snapshot: recording, controller } = useMeetingRecording();
  const [now, setNow] = useState(() => Date.now());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (recording.phase !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recording.phase]);
  if (recording.phase === "idle") return null;
  const elapsed = Math.max(0, Math.floor((now - recording.startedAt) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const pending = recording.parts.some(part => !part.delivered && part.text);
  const label = recording.phase === "connecting" ? "마이크 연결 중" : recording.phase === "recording" ? `녹음 중 · ${clock}` : recording.phase === "finishing" ? "마지막 음성 전사 중" : "녹음 종료";
  return <aside className="meeting-recording-bar" aria-label="진행 중인 회의 녹음">
    <div><strong role="status">{label}</strong><Link href={`/knowledge/meetings/${recording.meetingId}`}>{recording.title} · 회의 메모로</Link>
      <small>{recording.phase === "recording" ? recording.live ? "실시간 받아쓰기 연결됨 · 다른 메뉴에서도 녹음이 이어집니다" : "받아쓰기 연결 중 · 음성은 녹음하고 있습니다" : pending ? "회의 메모로 돌아가면 받아쓴 내용을 추가합니다" : "받아쓴 내용은 회의 메모에서 확인하세요"}</small>
      {recording.error && <small role="alert">{recording.error}</small>}
    </div>
    <div className="meeting-recording-controls">
      {["connecting", "recording"].includes(recording.phase) && <button onClick={controller.stop}>{recording.phase === "connecting" ? "취소" : "녹음 종료"}</button>}
      {recording.phase === "ready" && recording.audio && <button onClick={() => void controller.retry()}>전사 다시 시도</button>}
      {recording.phase === "ready" && <button onClick={() => {
        if (pending || recording.audio || recording.recovery) setConfirmDiscard(true);
        else controller.reset();
      }}>결과 닫기</button>}
      {confirmDiscard && <div role="alert"><span>메모에 추가하지 않은 결과를 버릴까요?</span><button onClick={() => { setConfirmDiscard(false); controller.reset(); }}>버리기</button><button onClick={() => setConfirmDiscard(false)}>계속 확인</button></div>}
    </div>
  </aside>;
}

/** Mount only in its originating editable memo. Route changes never stop the controller. */
export function MeetingLiveTranscript({ meetingId, append }: { meetingId: string; append: (text: string) => boolean }) {
  const { snapshot, controller } = useMeetingRecording();
  const appendRef = useRef(append); appendRef.current = append;
  useEffect(() => { controller.drain(meetingId, text => appendRef.current(text)); }, [controller, meetingId, snapshot.parts]);
  if (snapshot.meetingId !== meetingId) return null;
  const provisional = snapshot.parts.filter(part => !part.final || !part.delivered).map(part => part.text).filter(Boolean).join("\n\n");
  return <div className="meeting-live-transcript" aria-label="회의 메모 실시간 받아쓰기">
    {["recording", "finishing"].includes(snapshot.phase) && <small>{snapshot.phase === "finishing" ? "마지막 음성을 받아쓰는 중…" : snapshot.live ? "● 실시간 받아쓰기" : "● 녹음 중 · 받아쓰기 연결 중"}</small>}
    {provisional && <p role="status" aria-live="polite">{provisional}</p>}
    {snapshot.recovery && <details open><summary>복구한 전체 전사 · 기존 받아쓰기와 겹치는 부분을 확인하세요</summary><textarea aria-label="복구한 전체 전사" readOnly value={snapshot.recovery} rows={8}/></details>}
  </div>;
}

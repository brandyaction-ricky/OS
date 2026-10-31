"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createTranscriptInbox } from "@/lib/meeting-transcript-inbox";
import { useSegmentedRecorder } from "./meeting-recorder";
import { useSession } from "./session-provider";

// One recorder for the whole app, so a meeting keeps recording while people open other menus
// (리키님 #177 이어받기). It stops only on 녹음 종료, sign-out, another account, or closing/reloading the tab.
type Meeting = { id: string; title: string; href: string };
type RecordingContext = {
  recorder: ReturnType<typeof useSegmentedRecorder>;
  meeting: Meeting | null;
  start: (meeting: Meeting) => Promise<void>;
  /** The meeting screen hands over its notes; transcripts that waited are appended now. Returns the detach. */
  attach: (meetingId: string, append: (text: string) => boolean) => () => void;
};
const Context = createContext<RecordingContext | null>(null);
export const useMeetingRecording = () => useContext(Context);

export function MeetingRecordingProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, profile } = useSession();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [attached, setAttached] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const meetingRef = useRef(meeting); meetingRef.current = meeting;
  const inbox = useRef(createTranscriptInbox());
  const sink = useRef<{ id: string; append: (text: string) => boolean } | null>(null);
  const recorder = useSegmentedRecorder({ token: accessToken, onTranscript: text => {
    const id = meetingRef.current?.id;
    if (!id) return;
    if (sink.current?.id === id && sink.current.append(text)) return;
    inbox.current.push(id, text); setWaiting(inbox.current.count(id));
  } });
  // The hook hands back new functions every render; the effect below must not restart with them.
  const stopRef = useRef(recorder.stop); stopRef.current = recorder.stop;
  // Another account (or none) never inherits a microphone or another person's meeting notes.
  const owner = profile?.id ?? null;
  useEffect(() => () => { stopRef.current(); inbox.current.clear(); setMeeting(null); setWaiting(0); }, [owner]);
  // One meeting at a time: a second start while recording would open another microphone stream.
  const start = async (next: Meeting) => { if (recorder.recording) return; setMeeting(next); await recorder.start(); };
  const attach = useCallback((meetingId: string, append: (text: string) => boolean) => {
    sink.current = { id: meetingId, append }; setAttached(meetingId);
    // Any meeting's waiting transcripts land when its screen opens, even after another meeting was recorded since.
    const left = inbox.current.flush(meetingId, append);
    if (meetingRef.current?.id === meetingId) setWaiting(left);
    return () => { if (sink.current?.id === meetingId) { sink.current = null; setAttached(null); } };
  }, []);
  const away = meeting && attached !== meeting.id && (recorder.recording || waiting > 0);
  return <Context.Provider value={{ recorder, meeting, start, attach }}>
    {children}
    {away ? <div className="meeting-recording-away" role="status">
      <span>{recorder.recording ? <><b>● 회의 녹음 중</b> · {meeting.title} · {recorder.minutes}분</> : <>받아쓴 글 {waiting}개가 「{meeting.title}」 메모에 아직 안 붙었어요</>}</span>
      <Link href={meeting.href}>회의로 가기</Link>
      {recorder.recording ? <button type="button" onClick={recorder.stop}>녹음 종료</button> : null}
    </div> : null}
  </Context.Provider>;
}

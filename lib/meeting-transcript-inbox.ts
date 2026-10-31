// 회의 녹음은 메뉴를 옮겨도 이어진다(리키님 #177 이어받기, 2026-10-31). 받아쓴 구간은 그 회의 화면이 열려 있으면
// 메모에 바로 붙고, 아니면 여기서 기다렸다가 그 회의로 돌아오면 순서대로 한 번에 붙는다. 붙이지 못한 글은 남는다.
export function createTranscriptInbox() {
  const waiting = new Map<string, string[]>();
  return {
    push(meetingId: string, text: string) { waiting.set(meetingId, [...(waiting.get(meetingId) ?? []), text]); },
    /** Appends what waits for this meeting in order; whatever append refuses stays for the next try. Returns how many still wait. */
    flush(meetingId: string, append: (text: string) => boolean) {
      const left = (waiting.get(meetingId) ?? []).filter(text => !append(text));
      if (left.length) waiting.set(meetingId, left); else waiting.delete(meetingId);
      return left.length;
    },
    count(meetingId: string) { return waiting.get(meetingId)?.length ?? 0; },
    clear() { waiting.clear(); },
  };
}

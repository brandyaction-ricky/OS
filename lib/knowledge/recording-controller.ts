/** One in-memory recording per signed-in app session. No route/component owns the microphone. */
export type RecordingPhase = "idle" | "connecting" | "recording" | "finishing" | "ready";
export type TranscriptPart = { id: string; text: string; final: boolean; delivered: boolean; previous?: string | null; committed: boolean };
export type RecordingSnapshot = {
  meetingId: string; title: string; phase: RecordingPhase; startedAt: number;
  live: boolean; error: string; parts: TranscriptPart[]; audio: Blob | null; recovery: string;
};
export const EMPTY_RECORDING: RecordingSnapshot = { meetingId: "", title: "", phase: "idle", startedAt: 0, live: false, error: "", parts: [], audio: null, recovery: "" };
type Dependencies = {
  microphone: () => Promise<MediaStream>;
  recorder: (stream: MediaStream) => MediaRecorder;
  peer: () => RTCPeerConnection;
  negotiate: (meetingId: string, sdp: string, signal: AbortSignal) => Promise<string>;
  transcribe: (audio: Blob) => Promise<string>;
};

export class MeetingRecordingController {
  private state: RecordingSnapshot = EMPTY_RECORDING;
  private listeners = new Set<() => void>();
  private media: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private request: AbortController | null = null;
  private chunks: Blob[] = [];
  private generation = 0;
  private speech = false;
  private finishTimer?: ReturnType<typeof setTimeout>;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private bytes = 0;
  private fallbackRunning = false;
  constructor(private dependencies: Dependencies) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<RecordingSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private valid(generation: number) { return generation === this.generation; }

  async start(meetingId: string, title: string) {
    if (this.state.phase !== "idle") throw new Error("진행 중인 녹음을 종료하고 결과를 확인해 주세요.");
    const generation = ++this.generation;
    this.update({ ...EMPTY_RECORDING, meetingId, title, phase: "connecting" });
    try {
      const media = await this.dependencies.microphone();
      if (!this.valid(generation)) { media.getTracks().forEach(track => track.stop()); return; }
      this.media = media;
      this.recorder = this.dependencies.recorder(media);
      const recorder = this.recorder;
      this.chunks = []; this.bytes = 0;
      recorder.ondataavailable = event => {
        if (!this.valid(generation) || !event.data.size) return;
        this.chunks.push(event.data); this.bytes += event.data.size;
        if (this.bytes >= 3_900_000) {
          this.update({ error: "음성 복구 파일 한도에 도달해 녹음을 마무리합니다. 결과 확인 후 이어서 녹음해 주세요." });
          this.stop();
        }
      };
      recorder.onerror = () => {
        if (!this.valid(generation)) return;
        this.update({ error: "마이크 녹음이 중단됐습니다. 남은 음성으로 전사를 복구합니다.", live: false }); this.stop();
      };
      recorder.onstop = () => {
        if (!this.valid(generation)) return;
        const audio = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
        this.chunks = [];
        this.update({ audio: audio.size ? audio : null });
        this.media?.getTracks().forEach(track => track.stop()); this.media = null;
        // Wait for the last Realtime result before closing its data channel.
        this.maybeFinish();
      };
      media.getAudioTracks().forEach(track => track.addEventListener("ended", () => {
        if (this.valid(generation) && this.state.phase === "recording") {
          this.update({ error: "마이크 연결이 끊겨 녹음을 마무리합니다." }); this.stop();
        }
      }));
      recorder.start(1000);
      this.update({ phase: "recording", startedAt: Date.now() });
      // Keep within the existing 4MB recovery endpoint and Realtime session duration.
      this.limitTimer = setTimeout(() => {
        this.update({ error: "15분 녹음을 마무리합니다. 결과 확인 후 이어서 녹음해 주세요." }); this.stop();
      }, 15 * 60_000);
      try {
        const peer = this.dependencies.peer(); this.peer = peer;
        media.getAudioTracks().forEach(track => peer.addTrack(track, media));
        const channel = peer.createDataChannel("oai-events"); this.channel = channel;
        channel.onopen = () => { if (this.valid(generation)) this.update({ live: true }); };
        channel.onmessage = event => {
          if (!this.valid(generation)) return;
          try { this.receive(JSON.parse(event.data)); } catch { /* Ignore malformed transport events. */ }
        };
        channel.onerror = () => { if (this.valid(generation)) this.connectionFailed(); };
        channel.onclose = () => { if (this.valid(generation) && this.snapshot().phase === "recording") this.connectionFailed(); };
        peer.onconnectionstatechange = () => {
          if (this.valid(generation) && ["failed", "disconnected"].includes(peer.connectionState)) this.connectionFailed();
        };
        const offer = await peer.createOffer();
        if (!this.valid(generation) || this.snapshot().phase !== "recording") return;
        await peer.setLocalDescription(offer);
        this.request = new AbortController();
        const answer = await this.dependencies.negotiate(meetingId, offer.sdp ?? "", this.request.signal);
        if (!this.valid(generation) || this.snapshot().phase !== "recording") return;
        await peer.setRemoteDescription({ type: "answer", sdp: answer });
      } catch {
        if (this.valid(generation) && this.snapshot().phase === "recording") this.connectionFailed();
      }
    } catch {
      if (!this.valid(generation)) return;
      this.release();
      this.update({ phase: "ready", error: "마이크를 사용할 수 없습니다. 브라우저 마이크 권한을 확인해 주세요." });
    }
  }

  private connectionFailed() {
    this.update({ live: false, error: "실시간 전사 연결이 끊겼습니다. 녹음은 계속되며 종료 후 음성으로 복구합니다." });
  }
  /** Match delta/completion by item_id; the API can complete later turns first. */
  receive(event: { type?: string; item_id?: string; previous_item_id?: string | null; delta?: string; transcript?: string }) {
    if (!["recording", "finishing"].includes(this.state.phase)) return;
    if (event.type === "input_audio_buffer.speech_started") { this.speech = true; return; }
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") { this.connectionFailed(); return; }
    const committed = event.type === "input_audio_buffer.committed";
    const delta = event.type === "conversation.item.input_audio_transcription.delta";
    const final = event.type === "conversation.item.input_audio_transcription.completed";
    if (!(committed || delta || final) || !event.item_id) return;
    if (committed) this.speech = false;
    const parts = this.state.parts.map(part => ({ ...part }));
    let part = parts.find(item => item.id === event.item_id);
    if (!part) { part = { id: event.item_id, text: "", final: false, delivered: false, committed: false }; parts.push(part); }
    if (committed) { part.previous = event.previous_item_id ?? null; part.committed = true; }
    if (delta && !part.final) part.text = (part.text + (event.delta ?? "")).slice(0, 20_000);
    if (final && !part.final) { part.text = (event.transcript ?? "").trim().slice(0, 20_000); part.final = true; }
    // Stable topological order, including commits arriving after transcript events.
    const ordered: TranscriptPart[] = [], remaining = [...parts];
    while (remaining.length) {
      const index = remaining.findIndex(item => item.committed && (!item.previous || ordered.some(p => p.id === item.previous) || !parts.some(p => p.id === item.previous)));
      ordered.push(...remaining.splice(index < 0 ? 0 : index, 1));
    }
    this.update({ parts: ordered }); this.maybeFinish();
  }

  /** Drain only consecutive committed finals; retain all text until explicit result dismissal. */
  drain(meetingId: string, append: (text: string) => boolean) {
    if (meetingId !== this.state.meetingId) return;
    const deliver: TranscriptPart[] = [];
    for (const part of this.state.parts) {
      if (!part.committed || !part.final) break;
      if (!part.delivered) deliver.push(part);
    }
    if (!deliver.length) return;
    const text = deliver.map(part => part.text).filter(Boolean).join("\n\n");
    if (text && !append(text)) return;
    const ids = new Set(deliver.map(part => part.id));
    this.update({ parts: this.state.parts.map(part => ids.has(part.id) ? { ...part, delivered: true } : part) });
  }

  stop = () => {
    if (!["connecting", "recording"].includes(this.state.phase)) return;
    if (this.state.phase === "connecting") { this.reset(); return; }
    this.update({ phase: "finishing" }); clearTimeout(this.limitTimer);
    if (this.speech && this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
    // Allow server VAD/commit and its transcription to finish even after mic stop.
    this.finishTimer = setTimeout(() => { void this.finish(); }, 8_000);
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    else this.maybeFinish();
  };
  private maybeFinish() {
    if (this.state.phase !== "finishing" || this.recorder?.state !== "inactive") return;
    if (this.state.parts.length && this.state.parts.every(part => part.final) && !this.speech) {
      // A short grace period covers a final commit queued on the data channel.
      clearTimeout(this.finishTimer); this.finishTimer = setTimeout(() => { void this.finish(); }, 700);
    }
  }
  private async finish() {
    if (this.state.phase !== "finishing") return;
    const recover = !this.state.live || this.speech || this.state.parts.some(part => !part.final) || !this.state.parts.some(part => part.text);
    this.release();
    if (recover && this.state.audio) { await this.retry(); return; }
    this.update({ phase: "ready", live: false, audio: null });
  }
  retry = async () => {
    if (!this.state.audio || this.fallbackRunning) return;
    const generation = this.generation, audio = this.state.audio;
    this.fallbackRunning = true; this.update({ phase: "finishing", error: "" });
    try {
      const text = await this.dependencies.transcribe(audio);
      if (!this.valid(generation)) return;
      if (!this.state.parts.some(part => part.text)) {
        this.update({ parts: [{ id: "recovery", text, final: true, delivered: false, committed: true }], audio: null, recovery: "" });
      } else {
        // Full-file fallback overlaps live text. Require review rather than duplicate it in the memo.
        this.update({ recovery: text, audio: null });
      }
      this.update({ phase: "ready", live: false });
    } catch {
      if (this.valid(generation)) this.update({ phase: "ready", live: false, error: "음성 전사를 복구하지 못했습니다. 이 브라우저에 음성을 유지하므로 다시 시도할 수 있습니다." });
    } finally { if (this.valid(generation)) this.fallbackRunning = false; }
  };
  private release() {
    clearTimeout(this.finishTimer); clearTimeout(this.limitTimer); this.request?.abort(); this.request = null;
    if (this.recorder) {
      this.recorder.onstop = null; this.recorder.ondataavailable = null; this.recorder.onerror = null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
    }
    this.recorder = null;
    if (this.channel) { this.channel.onclose = null; this.channel.onerror = null; this.channel.onmessage = null; this.channel.close(); }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.close(); }
    this.channel = null; this.peer = null;
    this.media?.getTracks().forEach(track => track.stop()); this.media = null; this.chunks = []; this.speech = false;
  }
  reset = () => { this.generation++; this.release(); this.fallbackRunning = false; this.update(EMPTY_RECORDING); };
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Images, Table2 } from "lucide-react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { newThreadsReference, type ThreadsReferenceItem } from "@/lib/threads-reference";
import { parseYoutubeRef } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";

/** One reference card: the document's header block (텔레그램 수집, 1단계) read back by the server. */
interface ArchiveCard {
  id: string; version: number; title: string; createdAt: string; link: string; platform: string; format: string; topic: string; room: string; who: string;
  at: string; channel: string; thumbnail: string; image: string; views: string; likes: string; mentions: number; state: string; note: string;
}
interface ArchiveList { cards: ArchiveCard[]; topics: string[]; states: string[]; truncated: boolean }

const DEMO: ArchiveList = {
  topics: ["후킹·대본 구조", "썸네일·제목", "채널·계정 포맷", "영상 연출·편집", "AI 툴·자동화", "마케팅·세일즈 사례", "콘텐츠 주제 소재", "미분류"],
  states: ["새로 들어옴", "검토함", "주제 후보", "사용함", "보관"], truncated: false,
  cards: [
    { id: "demo-a1", version: 1, title: "첫 3초에 질문을 던지는 릴스", createdAt: "2026-11-16T07:12:00.000Z", link: "https://instagram.com/reel/DEMO1", platform: "Instagram", format: "숏폼",
      topic: "후킹·대본 구조", room: "인스타 아카이빙", who: "직원A", at: "2026-11-16T07:12:00.000Z", channel: "@demo.account", thumbnail: "", image: "", views: "", likes: "",
      mentions: 1, state: "새로 들어옴", note: "#후킹 첫 3초 질문 → 바로 답 안 줌. 우리 숏폼 도입에 써 보면 좋겠어요" },
    { id: "demo-a2", version: 1, title: "썸네일 글자 두 줄 비교", createdAt: "2026-11-15T03:00:00.000Z", link: "https://youtube.com/watch?v=DemoVideo01", platform: "YouTube", format: "롱폼",
      topic: "썸네일·제목", room: "썸네일 아카이빙", who: "직원B", at: "2026-11-15T03:00:00.000Z", channel: "데모 채널", thumbnail: "", image: "", views: "182000", likes: "4100",
      mentions: 0, state: "검토함", note: "큰 숫자 + 짧은 질문" },
    { id: "demo-a3", version: 1, title: "자막 자동 정렬 툴", createdAt: "2026-11-10T09:30:00.000Z", link: "https://example.com/tool", platform: "기타", format: "툴·기타",
      topic: "AI 툴·자동화", room: "AI방", who: "직원A", at: "2026-11-10T09:30:00.000Z", channel: "", thumbnail: "", image: "", views: "", likes: "", mentions: 0,
      state: "새로 들어옴", note: "편집 시간 줄일 수 있을지" },
  ],
};
const ALL = "전체";
const PERIODS = [["all", "전체 기간"], ["7", "지난 7일"], ["30", "지난 30일"]] as const;
const day = (iso: string) => iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const count = (value: string) => value && Number(value) ? Number(value).toLocaleString("ko-KR") : "";
interface Meeting { id: string; title: string; brand: string; status: string; startsAt: string | null }
const DEMO_MEETINGS: Meeting[] = [{ id: "demo-m1", title: "주간 콘텐츠 회의", brand: "브랜디액션", status: "planned", startsAt: "2026-11-18T01:00:00.000Z" }];
const REFERENCE_PLATFORM: Record<string, ThreadsReferenceItem["platform"]> = { Threads: "threads", Instagram: "instagram", YouTube: "youtube", TikTok: "tiktok" };
/** A login wall's 「Instagram」 is no title: the note's first line (or the link) names the card instead. */
const nameOf = (card: ArchiveCard) => card.title && card.title !== card.platform ? card.title : card.note.split("\n")[0] || card.link || "레퍼런스";

/**
 * 아카이브 (수정 요청 2026-11-13, 2단계): what the team drops in the Telegram archive rooms — links and pictures with a one-line note —
 * sorted into eight topic folders. Gallery first (picture, title, link, who · room · when on every card), a table as the second view.
 * 상태 and 주제 are the two things people change; moving a card to another folder is the answer the AI's guess yields to.
 */
export function YoutubeArchiveScreen() {
  const { accessToken, demo } = useSession();
  const [list, setList] = useState<ArchiveList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const [topic, setTopic] = useState(ALL);
  const [pick, setPick] = useState({ room: ALL, who: ALL, platform: ALL, format: ALL, state: ALL });
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("all");
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<{ id: string; text: string; href: string } | null>(null);
  // 회의 안건으로 (대표 2026-11-16): the meetings not held yet, picked on the card.
  const [meetingFor, setMeetingFor] = useState<{ id: string; meetings: Meeting[] | null; chosen: string } | null>(null);
  const load = useCallback(async () => {
    if (demo) { setList((now) => now ?? DEMO); return; }
    try { setList(await apiRequest<ArchiveList>("/api/v1/content/archive", { token: accessToken })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "아카이브를 불러오지 못했어요."); }
  }, [accessToken, demo]);
  useEffect(() => { void load(); }, [load]);

  const change = async (card: ArchiveCard, patch: { state?: string; topic?: string }) => {
    setBusy(card.id); setError("");
    try {
      if (demo) setList((now) => now && { ...now, cards: now.cards.map((item) => item.id === card.id ? { ...item, ...patch, version: item.version + 1 } : item) });
      else { await apiRequest("/api/v1/content/archive", { method: "PATCH", token: accessToken, body: JSON.stringify({ id: card.id, version: card.version, ...patch }) }); await load(); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "바꾸지 못했어요.");
      if (reason instanceof ApiRequestError && reason.status === 409) await load();
    } finally { setBusy(""); }
  };

  // 3단계 (수정 요청 2026-11-13): a card goes on into the screens that use it; each way turns it 주제 후보.
  const send = async (card: ArchiveCard, way: "kept" | "short" | "ad" | "threads") => {
    setBusy(card.id); setError(""); setSent(null);
    try {
      if (way === "kept") {
        const done = demo ? { existed: false } : await apiRequest<{ existed: boolean }>("/api/v1/content/archive", { method: "POST", token: accessToken, body: JSON.stringify({ id: card.id }) });
        setSent({ id: card.id, text: done.existed ? "이미 담아 둔 영상이에요. 주제 후보로 표시했어요." : "담아 둔 영상에 넣었어요.", href: "/content/projects?view=discover&platform=longform" });
        if (demo) await change(card, { state: "주제 후보" }); else await load();
        return;
      }
      if (way === "threads") {
        const item: ThreadsReferenceItem = { ...newThreadsReference(), url: card.link, title: nameOf(card).slice(0, 240), platform: REFERENCE_PLATFORM[card.platform] ?? "other",
          author: card.channel.slice(0, 240), readNote: `텔레그램 아카이브 · ${card.room} · ${card.who}${card.note ? `: ${card.note}` : ""}`.slice(0, 3000) };
        if (!demo) await apiRequest("/api/v1/content/automation/topics", { method: "POST", token: accessToken, body: JSON.stringify({ title: item.title, source: "reference",
          sourceRef: item.url, kind: "threads_reference", editorial_workflow: "threads_reference_v1", reference_items: [item], requestId: crypto.randomUUID() }) });
        setSent({ id: card.id, text: "내 스레드 글감(레퍼런스 수집)에 넣었어요. 나에게만 보여요.", href: "/automation/references" });
      }
      if (card.state !== "주제 후보") await change(card, { state: "주제 후보" });
      if (way === "short" || way === "ad") window.location.assign(`/content/projects?view=discover&platform=${way}&link=${encodeURIComponent(card.link)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "보내지 못했어요."); }
    finally { setBusy(""); }
  };

  const pickMeeting = async (card: ArchiveCard) => {
    setMeetingFor({ id: card.id, meetings: null, chosen: "" }); setError(""); setSent(null);
    try {
      const { meetings } = demo ? { meetings: DEMO_MEETINGS } : await apiRequest<{ meetings: Meeting[] }>("/api/v1/content/archive?meetings=1", { token: accessToken });
      setMeetingFor({ id: card.id, meetings, chosen: meetings[0]?.id ?? "" });
    } catch (reason) { setMeetingFor(null); setError(reason instanceof Error ? reason.message : "다가오는 회의를 불러오지 못했어요."); }
  };
  const addToMeeting = async (card: ArchiveCard) => {
    const meeting = meetingFor?.meetings?.find((item) => item.id === meetingFor.chosen);
    if (!meeting) return;
    setBusy(card.id); setError("");
    try {
      const done = demo ? { added: true } : await apiRequest<{ added: boolean }>("/api/v1/content/archive", { method: "POST", token: accessToken, body: JSON.stringify({ id: card.id, meetingId: meeting.id }) });
      setSent({ id: card.id, text: done.added ? `「${meeting.title}」 안건 끝에 붙였어요.` : `「${meeting.title}」 안건에 이미 있어요.`, href: "" });
      setMeetingFor(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "회의 안건에 붙이지 못했어요."); }
    finally { setBusy(""); }
  };

  const cards = useMemo(() => list?.cards ?? [], [list]);
  const options = (key: keyof typeof pick) => [...new Set(cards.map((card) => card[key]).filter(Boolean))].sort();
  const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const words = query.trim().toLowerCase();
  const shown = cards.filter((card) => (topic === ALL || card.topic === topic)
    && (Object.keys(pick) as (keyof typeof pick)[]).every((key) => pick[key] === ALL || card[key] === pick[key])
    && (!since || Date.parse(card.at || card.createdAt) >= since)
    && (!words || [card.title, card.note, card.channel, card.who, card.room, card.link].join(" ").toLowerCase().includes(words)));
  const select = (key: keyof typeof pick, label: string) => <label className="yp-arc-f"><span>{label}</span>
    <select className="yp-in" value={pick[key]} onChange={(event) => setPick((now) => ({ ...now, [key]: event.target.value }))}>
      <option value={ALL}>{ALL}</option>{options(key).map((value) => <option key={value}>{value}</option>)}</select></label>;
  const controls = (card: ArchiveCard) => <span className="yp-arc-acts">
    <select className="yp-in" aria-label="주제 폴더" value={card.topic} disabled={busy === card.id} onChange={(event) => void change(card, { topic: event.target.value })}>
      {(list?.topics ?? []).map((value) => <option key={value}>{value}</option>)}</select>
    <select className="yp-in" aria-label="상태" value={card.state} disabled={busy === card.id} onChange={(event) => void change(card, { state: event.target.value })}>
      {(list?.states ?? []).map((value) => <option key={value}>{value}</option>)}</select>
  </span>;
  const ways = (card: ArchiveCard) => {
    const video = Boolean(parseYoutubeRef(card.link)) && card.format !== "채널", short = card.format === "숏폼";
    return <span className="yp-arc-links">
      {video ? <button type="button" className="yp-btn yp-sm" disabled={busy === card.id} onClick={() => void send(card, "kept")}>담아 둔 영상에 담기</button> : null}
      {short ? <button type="button" className="yp-btn yp-sm" disabled={busy === card.id} onClick={() => void send(card, "short")}>숏폼으로 시작</button> : null}
      {short ? <button type="button" className="yp-btn yp-sm" disabled={busy === card.id} onClick={() => void send(card, "ad")}>광고로 시작</button> : null}
      {/^https:\/\//.test(card.link) ? <button type="button" className="yp-btn yp-sm" disabled={busy === card.id} onClick={() => void send(card, "threads")}>스레드 글감으로</button> : null}
      <button type="button" className="yp-btn yp-sm" disabled={busy === card.id} aria-expanded={meetingFor?.id === card.id} onClick={() => meetingFor?.id === card.id ? setMeetingFor(null) : void pickMeeting(card)}>회의 안건으로</button>
      {meetingFor?.id === card.id ? <span className="yp-arc-meeting">{meetingFor.meetings === null ? <span className="yp-hint" role="status">다가오는 회의를 찾는 중…</span>
        : !meetingFor.meetings.length ? <span className="yp-hint">예정된 회의가 없어요. 회의를 먼저 만들어 주세요.</span>
        : <><select className="yp-in" aria-label="붙일 회의" value={meetingFor.chosen} onChange={(event) => setMeetingFor({ ...meetingFor, chosen: event.target.value })}>
            {meetingFor.meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.startsAt ? `${day(meeting.startsAt)} · ` : ""}{meeting.brand ? `${meeting.brand} · ` : ""}{meeting.title}{meeting.status === "active" ? " (진행 중)" : ""}</option>)}</select>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy === card.id || !meetingFor.chosen} onClick={() => void addToMeeting(card)}>붙이기</button></>}</span> : null}
      {sent?.id === card.id ? <span className="yp-hint" role="status">{sent.text}{sent.href ? <> <a href={sent.href}>열기</a></> : null}</span> : null}
    </span>;
  };
  const links = (card: ArchiveCard) => <span className="yp-arc-links">
    {card.link ? <a className="yp-btn yp-sm" href={card.link} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" /> 원본</a> : null}
    {demo ? null : <a className="yp-btn yp-sm" href={`/knowledge?document=${encodeURIComponent(card.id)}`}><FileText size={12} aria-hidden="true" /> 문서</a>}
  </span>;

  return <div className="yp-arc">
    <p className="yp-hint">텔레그램 아카이브 방(인스타 아카이빙 · 썸네일 아카이빙 · AI방)에 올라온 링크와 사진이 여기 모여요. 같은 링크는 한 장으로 합치고 「추가 언급」으로 세요.
      주제 폴더는 AI가 먼저 고르고, 사람이 옮기면 그게 정답이에요.</p>
    {error ? <p className="yp-errline" role="alert">{error}</p> : null}
    <div className="yp-arc-topics" role="group" aria-label="주제 폴더">
      {[ALL, ...(list?.topics ?? [])].map((value) => { const n = value === ALL ? cards.length : cards.filter((card) => card.topic === value).length;
        return <button key={value} type="button" className={`yp-arc-topic${topic === value ? " yp-on" : ""}`} aria-pressed={topic === value} onClick={() => setTopic(value)}>{value} <b>{n}</b></button>; })}
    </div>
    <div className="yp-arc-filters">
      {select("room", "방")}{select("who", "올린 사람")}{select("platform", "플랫폼")}{select("format", "형식")}{select("state", "상태")}
      <label className="yp-arc-f"><span>기간</span><select className="yp-in" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
        {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="yp-arc-f yp-arc-q"><span>찾기</span><input className="yp-in" type="search" value={query} placeholder="제목 · 코멘트 · 채널 · 사람" onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="yp-seg2" role="group" aria-label="보기">
        <button type="button" className={view === "gallery" ? "yp-on" : ""} aria-pressed={view === "gallery"} onClick={() => setView("gallery")}><Images size={13} aria-hidden="true" /> 갤러리</button>
        <button type="button" className={view === "table" ? "yp-on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}><Table2 size={13} aria-hidden="true" /> 표</button>
      </div>
    </div>
    {!list ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
      : !shown.length ? <p className="yp-hint">{cards.length ? "조건에 맞는 카드가 없어요." : "아직 모인 링크가 없어요. 아카이브 방에 링크를 올리면 1분 안에 여기 나타나요."}</p>
      : view === "gallery" ? <ul className="yp-arc-grid">{shown.map((card) => <li key={card.id} className="yp-arc-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- the platform's own thumbnail or a short-lived signed address */}
        {card.image || card.thumbnail ? <img className="yp-arc-pic" src={card.image || card.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <div className="yp-arc-pic yp-arc-nopic" aria-hidden="true">{card.platform} · {card.format}</div>}
        <div className="yp-arc-body">
          <b className="yp-arc-title">{nameOf(card)}</b>
          <span className="yp-arc-meta">{card.who} · {card.room} · {day(card.at || card.createdAt)}</span>
          <span className="yp-arc-chips"><span className="yp-tag">{card.platform}</span><span className="yp-tag">{card.format}</span>
            {card.channel ? <span className="yp-tag">{card.channel}</span> : null}{count(card.views) ? <span className="yp-tag">조회 {count(card.views)}</span> : null}
            {card.mentions ? <span className="yp-tag yp-acc">추가 언급 {card.mentions}</span> : null}</span>
          {card.note ? <p className="yp-arc-note">{card.note}</p> : null}
          {controls(card)}{ways(card)}{links(card)}
        </div>
      </li>)}</ul>
      : <div className="yp-arc-table"><table><thead><tr><th>제목</th><th>주제</th><th>형식</th><th>플랫폼</th><th>올린 사람</th><th>방</th><th>시각</th><th>상태</th><th>원본</th></tr></thead>
        <tbody>{shown.map((card) => <tr key={card.id}><td>{nameOf(card)}{card.mentions ? <small> · 추가 언급 {card.mentions}</small> : null}</td><td>{card.topic}</td><td>{card.format}</td>
          <td>{card.platform}</td><td>{card.who}</td><td>{card.room}</td><td>{day(card.at || card.createdAt)}</td><td>{card.state}</td>
          <td>{card.link ? <a href={card.link} target="_blank" rel="noreferrer">열기</a> : "–"}</td></tr>)}</tbody></table></div>}
    {list?.truncated ? <p className="yp-hint">최근 500장까지 보여요.</p> : null}
  </div>;
}

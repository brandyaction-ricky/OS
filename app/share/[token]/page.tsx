import type { Metadata } from "next";
import type { ReactNode } from "react";
import { markdownBlocks } from "@/lib/markdown-sections";
import { sharedDocument } from "@/lib/server/document-share";
import "./share.css";

// Public, login-free, read-only view of one document behind an external link. It sits outside
// the (os) layout, so no session or workspace navigation is loaded. Uploaded images stay inside
// the company and show as a note; links and text render as plain React (no raw HTML).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "공유 문서 | 브랜디액션", robots: { index: false, follow: false }, referrer: "no-referrer" };

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[\[([^\]\n]+)\]\]|@\{[^|{}]+\|([^{}]+)\}|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[2] !== undefined) out.push(/^https:\/\//.test(m[2]) ? <img key={k} src={m[2]} alt={m[1]} loading="lazy" /> : <span key={k} className="share-note">[이미지는 사내에서만 볼 수 있습니다]</span>);
    else if (m[4] !== undefined) out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer nofollow">{m[3]}</a>);
    else if (m[5] !== undefined) out.push(m[5].split("|").pop());
    else if (m[6] !== undefined) out.push(`@${m[6]}`);
    else if (m[7] !== undefined) out.push(<strong key={k}>{m[7]}</strong>);
    else out.push(<code key={k}>{m[8]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function block(raw: string, index: number): ReactNode {
  const lines = raw.split("\n");
  const fence = lines[0].match(/^\s{0,3}(`{3,}|~{3,})/);
  if (fence) return <pre key={index}><code>{lines.slice(1, lines.at(-1)?.trim().startsWith(fence[1]) ? -1 : undefined).join("\n")}</code></pre>;
  const toggle = lines[0].match(/^:::toggle\{title=("(?:\\.|[^"\\])*")\}\s*$/);
  if (toggle) {
    let title = ""; try { title = JSON.parse(toggle[1]); } catch { title = "펼치기"; }
    return <details key={index}><summary>{title}</summary>{markdownBlocks(lines.slice(1, lines.at(-1)?.trim() === ":::" ? -1 : undefined).join("\n")).map(block)}</details>;
  }
  const heading = raw.match(/^(#{1,6})\s+(.*)$/);
  if (heading && lines.length === 1) { const H = `h${Math.min(heading[1].length + 1, 6)}` as "h2"; return <H key={index}>{inline(heading[2], index)}</H>; }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) return <hr key={index} />;
  if (lines.every(line => /^\s*>/.test(line))) return <blockquote key={index}>{inline(lines.map(line => line.replace(/^\s*>\s?/, "")).join("\n"), index)}</blockquote>;
  if (lines.every(line => /^\s*([-*+]|\d+[.)])\s+/.test(line) || /^\s{2,}\S/.test(line))) {
    const ordered = /^\s*\d+[.)]/.test(lines[0]), List = ordered ? "ol" : "ul";
    return <List key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ""), index * 1000 + i)}</li>)}</List>;
  }
  if (lines.length > 1 && lines.every(line => line.trim().startsWith("|"))) {
    const rows = lines.filter(line => !/^\s*\|?\s*:?-{3,}/.test(line)).map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
    return <div key={index} className="share-table"><table><tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => r === 0 ? <th key={c}>{inline(cell)}</th> : <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
  }
  return <p key={index}>{inline(raw, index)}</p>;
}

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const doc = await sharedDocument((await params).token);
  if (!doc) return <main className="share-page"><h1>열 수 없는 링크입니다</h1><p>링크가 만료됐거나 해제됐습니다. 공유한 사람에게 새 링크를 요청해 주세요.</p></main>;
  const kst = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
  return <main className="share-page">
    <p className="share-meta">브랜디액션 공유 문서 · 읽기 전용 · 마지막 수정 {kst(doc.updatedAt)} · 링크 만료 {kst(doc.expiresAt)}</p>
    <h1>{doc.title}</h1>
    <article>{markdownBlocks(doc.content).map(block)}</article>
  </main>;
}

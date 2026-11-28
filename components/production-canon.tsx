"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { GRIND_KINDS, GRADUATION } from "@/lib/canon-grind/grind";
import type { CanonTrace } from "@/lib/youtube-process/canon-trace";
import { useSession } from "./session-provider";

interface Snapshot {
  formats: { label: string; href: string; current: string; tested: string; sample: number }[];
  product: { version: number; ref: CanonTrace | null; steward: string; count: number };
}
const url = "/api/v1/content/youtube/canon-grind?kind=overview";
const example: Snapshot = { formats: [["script", "롱폼 원고"], ...Object.entries(GRIND_KINDS).map(([id, v]) => [id, v.label])].map(([id, label]) => ({
  label, href: `/content/${id}-canon`, current: "v0.2", tested: "v0.1", sample: 2,
})), product: { version: 0, ref: null, steward: "", count: 0 } };

export function ProductionCanonScreen() {
  const { demo, accessToken, profile } = useSession();
  const [data, setData] = useState<Snapshot | null>(null);
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    if (demo) setData(example);
    else if (accessToken) void apiRequest<Snapshot>(url, { token: accessToken }).then(value => { if (current) { setData(value); setMessage(""); } }, () => { if (current) setMessage("정본 현황을 읽지 못했어요."); });
    return () => { current = false; };
  }, [demo, accessToken, reload]);
  async function assign() {
    if (!data || !accessToken || busy) return;
    const documentId = doc.trim().match(/^(?:[0-9a-f-]{36})$/i)?.[0] ?? doc.trim().match(/(?:\/knowledge\/doc\/|[?&]document=)([0-9a-f-]{36})(?:$|[&#?])/i)?.[1];
    if (!documentId) { setMessage("회사 문서 주소 또는 문서 ID를 확인해 주세요."); return; }
    setBusy(true);
    try {
      const product = await apiRequest<Snapshot["product"]>(url, { method: "POST", token: accessToken, body: JSON.stringify({ documentId, expectedVersion: data.product.version }) });
      setData({ ...data, product }); setDoc(""); setMessage("상품 사실 정본을 연결했어요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "저장하지 못했어요."); }
    finally { setBusy(false); }
  }
  return <><div className="yp-chips"><button className="yp-btn" onClick={() => setReload(n => n + 1)}>새로고침</button><Link className="yp-lnk" href="/knowledge/canon">회사 정본 관리 →</Link></div>
    {message && <p role="status">{message}</p>}
    {data ? <><div className="yp-card yp-card-b yp-scroll-x"><table className="data-table"><thead><tr><th>콘텐츠</th><th>사용 정본</th><th>마지막 시험</th><th>판정</th><th>작업</th></tr></thead><tbody>
      {data.formats.map(row => <tr key={row.href}><th scope="row">{row.label}</th><td>{row.current || "미등록"}</td><td>{row.tested || "시험 전"}</td><td>{row.current && row.tested && row.current !== row.tested && <strong className="yp-warn">버전 다름 · </strong>}{row.sample < GRADUATION.minimum ? `판단 보류 ${row.sample}건` : `표본 ${row.sample}건`}</td><td><Link className="yp-lnk" href={row.href}>{row.current !== row.tested ? "다시 검증" : "시험 보기"}</Link></td></tr>)}
      <tr><th scope="row">상품 사실</th><td>{data.product.ref ? <Link className="yp-lnk" href={`/knowledge/doc/${data.product.ref.id}`}>{data.product.ref.title} · v{data.product.ref.version}</Link> : "미등록"}</td><td>담당자 확인</td><td>{data.product.count}개 상품</td><td>{data.product.steward || "배정 필요"}</td></tr>
    </tbody></table></div>
    <section className="yp-card"><div className="yp-card-h"><b>상품 사실 정본 배정</b></div><div className="yp-card-b"><p>상품명, 가격, 무료·유료 범위, 문항 수, 소요 시간, 근거 주소, 확인일을 작성한 뒤 회사 정본에서 담당자와 공개 범위를 설정해 주세요.</p>
      <div className="yp-chips"><Link className="yp-btn" href="/knowledge/vault?new=1&template=product-facts">상품 사실 양식으로 작성</Link>
      {profile?.role === "admin" && !demo ? <><label>승인된 문서 <input className="yp-in" placeholder="회사 문서 주소 또는 문서 ID" value={doc} onChange={e => setDoc(e.target.value)} /></label><button className="yp-btn" disabled={busy || !doc.trim()} onClick={() => void assign()}>정본 연결</button></> : null}</div>
    </div></section></> : <p role="status">정본 현황을 불러오는 중이에요.</p>}</>;
}

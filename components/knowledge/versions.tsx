"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { diffMarkdownLines } from "@/lib/line-diff";
import type { DocumentVersion, KnowledgeDocument } from "@/lib/types";
import { kstTime } from "@/lib/knowledge/model";
import { useKnowledge } from "./provider";

export function VersionHistory({ document: doc, restored }: { document: KnowledgeDocument; restored: () => void }) {
  const { state, demo, token, command } = useKnowledge();
  const [versions, setVersions] = useState<DocumentVersion[]>([]), [page, setPage] = useState(0);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [compare, setCompare] = useState<DocumentVersion | null>(null);
  useEffect(() => {
    let live = true;
    if (demo) setVersions(state.versions[doc.id] ?? []);
    else void apiRequest<{versions: DocumentVersion[]}>(`/api/v1/documents/${doc.id}/versions`, { token })
      .then(result => { if (live) setVersions(result.versions); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [doc.id, demo, token, state.versions]);
  async function restore(v: DocumentVersion) {
    setBusy(true); setError("");
    try {
      await command({action:"document.commit", id:doc.id, expectedVersion:doc.current_version, title:v.title, content:v.content_md});
      restored();
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="kw-stack">{error && <p role="alert" className="kw-error">{error}</p>}
    {versions.slice(page*10, (page+1)*10).map(v => <article className="kw-card" key={v.version_no}>
      <h3>v{v.version_no} · {v.title}</h3><small>{kstTime(v.created_at)} · {v.author_name || "구성원"} · {v.reason}</small>
      <div className="kw-actions"><button onClick={() => setCompare(v)}>현재 버전과 비교</button>
        {doc.status === "canonical" ? <Link href={`/knowledge/canon/${doc.id}/propose?version=${v.version_no}`}>이 버전으로 변경 제안</Link>
          : <button disabled={busy || v.version_no === doc.current_version} onClick={() => void restore(v)}>이 버전으로 복원</button>}</div>
    </article>)}
    <div className="kw-actions"><button disabled={!page} onClick={()=>setPage(page-1)}>이전 10개</button>
      <small>{page+1} / {Math.max(1,Math.ceil(versions.length/10))}</small><button disabled={(page+1)*10>=versions.length} onClick={()=>setPage(page+1)}>다음 10개</button></div>
    {compare && <section className="kw-card"><h3>v{compare.version_no} → 현재 v{doc.current_version}</h3>
      <p>{compare.title} → {doc.title}</p><div className="kw-diff">{diffMarkdownLines(compare.content_md, versions[0]?.content_md ?? doc.content_md).map((line,i)=><pre key={i} className={`kw-diff-${line.kind}`}>{line.kind==="added"?"+":line.kind==="removed"?"−":" "} {line.text}</pre>)}</div>
      <button onClick={()=>setCompare(null)}>비교 닫기</button></section>}
  </div>;
}

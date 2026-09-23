"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { getDemoKnowledgeDocuments } from "@/lib/demo-knowledge-store";
import { knowledgeFolderOptions } from "@/lib/knowledge-folders";
import { useSession } from "./session-provider";

export function KnowledgeClassificationSettings() {
  const { demo, accessToken } = useSession();
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) { setFolders(knowledgeFolderOptions(getDemoKnowledgeDocuments().map(document => document.folder))); return; }
    if (!accessToken) return;
    let active = true;
    apiRequest<{folders: Array<{path: string}>}>("/api/v1/documents/index?folders=true&scope=all", {token: accessToken}).then(result => { if (active) setFolders(knowledgeFolderOptions(result.folders.map(item => item.path).filter(path => path !== "분류 없음"))); }).catch(() => { if (active) setError("폴더 목록을 불러오지 못했습니다. 문서 작업공간에서 다시 확인해 주세요."); });
    return () => { active = false; };
  }, [accessToken, demo]);
  return <section className="panel category-grid"><div className="panel-header"><div><h2>지식 폴더·분류</h2><p>문서 등록·편집·가져오기에서 같은 실제 폴더 목록을 사용합니다.</p></div><Link className="panel-link" href="/knowledge?folders=1">폴더 관리</Link></div>{error ? <p role="alert">{error}</p> : <div>{folders.filter(path => !path.includes("/")).map(path => <span key={path}>{path}</span>)}</div>}<p>이름과 상위 위치는 폴더 관리에서 변경할 수 있습니다. 태그는 문서의 여러 주제를 표시합니다.</p></section>;
}

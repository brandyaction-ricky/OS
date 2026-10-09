import type {DocumentVersion,KnowledgeDocument} from "../types";
import {kstTime} from "./model.ts";

export function documentMarkdown(doc:KnowledgeDocument,versions:DocumentVersion[]=[]){
  const current=`# ${doc.title}\n\nv${doc.current_version} · ${kstTime(doc.updated_at)}\n\n${doc.content_md}`;
  return versions.length?`${current}\n\n---\n\n# 버전 기록\n\n${versions.map(version=>`## v${version.version_no} · ${version.title}\n\n${kstTime(version.created_at)} · ${version.author_name||"구성원"}\n\n${version.content_md}`).join("\n\n---\n\n")}`:current;
}
export function safeExportName(title:string){return (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").slice(0,150)||"document")+".md";}

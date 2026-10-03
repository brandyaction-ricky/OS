export const SCRIPT_DOCUMENT_ROOT = "03_Content/롱폼/스크립트/02_초안";
export const SCRIPT_FOLDER_NAME_LIMIT = 160 - SCRIPT_DOCUMENT_ROOT.length - 1;
export const SCRIPT_DOCUMENT_STATUSES = "draft,team,review,reviewed,canonical";

type ScriptSummary = { source_ref?: string | null; title: string; folder: string; status: string; updated_at: string };
export const SCRIPT_STEPS = ["기획", "패키징", "자료", "축", "설계표", "초안", "다듬기", "발행"] as const;

export function scriptFileName(document: Pick<ScriptSummary, "source_ref" | "title">) {
  return (document.source_ref || document.title).split(/[\\/]/).at(-1) || document.title;
}

export function scriptVersionInfo(document: Pick<ScriptSummary, "source_ref" | "title">) {
  const name = scriptFileName(document).replace(/\.(?:md|markdown|txt)$/i, "");
  const match = name.match(/^(.*?)[\s_-]+v(\d+)$/i);
  if (!match || !match[1].trim()) return null;
  return { family: match[1].trim(), version: Number(match[2]) };
}

export function groupScriptVersions<T extends ScriptSummary & { id: string }>(documents: T[]) {
  const groups = new Map<string, { key: string; label: string; documents: T[]; latest: T }>();
  for (const document of documents) {
    const version = scriptVersionInfo(document);
    const key = version ? `version:${version.family.toLocaleLowerCase("ko-KR")}` : `single:${document.id}`;
    const group = groups.get(key) ?? { key, label: version?.family ?? scriptFileName(document), documents: [], latest: document };
    group.documents.push(document);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    group.documents.sort((a, b) => (scriptVersionInfo(b)?.version ?? -1) - (scriptVersionInfo(a)?.version ?? -1)
      || b.updated_at.localeCompare(a.updated_at));
    group.latest = group.documents[0];
    return group;
  });
}

export function isVisibleScript(document: Pick<ScriptSummary, "folder" | "status">) {
  return document.status !== "archived" && !document.folder.split("/").some((part) => part.startsWith("_"));
}

export function compareScriptDocuments(a: ScriptSummary, b: ScriptSummary) {
  const rank = (document: ScriptSummary) => {
    const name = scriptFileName(document).replace(/[ _-]/g, "");
    if (/직접수정/.test(name)) return 3;
    if (/낭독본최종|최종낭독본/.test(name)) return 2;
    if (/원고|초안/.test(name) && !/감사|검수|audit/i.test(name)) return 1;
    return 0;
  };
  return rank(b) - rank(a) || scriptFileName(b).localeCompare(scriptFileName(a), "ko", { numeric: true });
}

export function scriptProgress(documents: ScriptSummary[]) {
  const names = documents.map(scriptFileName);
  const completed = SCRIPT_STEPS.map((step) => names.some((name) => name.includes(step)));
  // A filename is an artifact signal, not an approval. Never infer approval from a later file.
  return { completed, published: names.some((name) => /발행|업로드완료/.test(name)), approvalPending: documents.some((doc) => doc.status === "review") };
}

export function normalizeScriptRoot(value: string) {
  const root = value.trim().replace(/^\/+|\/+$/g, "");
  if (!root || root.length > 150 || /[\\\u0000-\u001f]/.test(root) || root.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("_"))) {
    throw new Error("원고 기준 폴더는 지식의 일반 폴더 경로로 선택해 주세요.");
  }
  return root;
}

export function buildScriptDocumentInput(input: { title: string; folderName: string; content: string; root?: string }) {
  const title = input.title.trim();
  const folderName = input.folderName.trim();
  const root = normalizeScriptRoot(input.root ?? SCRIPT_DOCUMENT_ROOT);
  const folderNameLimit = 160 - root.length - 1;
  if (!title || title.length > 200) throw new Error("원고 제목은 1~200자로 입력해 주세요.");
  if (!folderName || folderName.length > folderNameLimit) {
    throw new Error(`영상 폴더명은 1~${folderNameLimit}자로 입력해 주세요.`);
  }
  if (/[\\/\u0000-\u001f]/.test(folderName) || folderName === "." || folderName === "..") {
    throw new Error("영상 폴더명에는 슬래시나 줄바꿈을 사용할 수 없습니다.");
  }
  const content = input.content.trim() || [
    `# ${title}`, "", "## 시청자와 핵심 메시지", "", "## 도입", "", "## 본문", "", "## 마무리와 다음 행동", "",
  ].join("\n");
  if (content.length > 1_500_000) throw new Error("원고 본문이 너무 깁니다. 내용을 나누어 저장해 주세요.");
  return { title, folder: `${root}/${folderName}`, content, source: "wiki", tags: ["원고"] };
}

// One rule for Threads posts, shared by the editor, the save validator and AI result intake.
// Length counts characters as people see them in most cases (code points), so an emoji is 1.
export const THREADS_POST_MAX=500;
export const THREADS_POSTS_MAX=30;
export const threadsPostLength=(text:string)=>Array.from(text).length;

// Returns a Korean message for the first problem, or null when the posts are valid.
export function threadsPostsProblem(posts:unknown,min=0):string|null{
  if(!Array.isArray(posts)||posts.some(post=>typeof post!=="string"))return "글타래 형식이 올바르지 않습니다.";
  if(posts.length<min)return "첫 글을 입력해 주세요.";
  if(posts.length>THREADS_POSTS_MAX)return `글은 ${THREADS_POSTS_MAX}개까지 만들 수 있습니다.`;
  const empty=posts.findIndex(post=>!post.trim());
  if(empty>=0)return `${empty+1}번 글이 비어 있습니다. 내용을 쓰거나 글을 지워 주세요.`;
  const long=posts.findIndex(post=>threadsPostLength(post)>THREADS_POST_MAX);
  if(long>=0)return `${long+1}번 글이 ${THREADS_POST_MAX}자를 넘습니다.`;
  return null;
}

// Position label: the first post is the body, a last post that is only a link is the source
// link, and every other post replies to the one before it.
export function threadsPostRole(posts:string[],index:number){
  if(index===0)return "본문";
  if(index===posts.length-1&&/^https?:\/\/\S+$/.test(posts[index].trim()))return `원문 링크 · ${index}번 글에 답글`;
  return `${index}번 글에 답글`;
}

export interface ThreadsClaim {
  post: number;
  sentence: number;
  text: string;
  kind: "" | "fact" | "interpretation";
  source: string;
}

/** Bind a decision to its exact sentence. Edits cannot inherit a previous sentence's evidence. */
export function threadsClaims(posts: unknown, saved: unknown): ThreadsClaim[] {
  if (!Array.isArray(posts)) return [];
  const segmenter = new Intl.Segmenter("ko", { granularity: "sentence" });
  const entries = new Map<string, ThreadsClaim>();
  if (Array.isArray(saved)) for (const item of saved) {
    if (item && typeof item.text === "string" && typeof item.source === "string" && ["fact", "interpretation"].includes(item.kind))
      entries.set(JSON.stringify([item.post,item.sentence,item.text]), item);
  }
  return posts.flatMap((value, post) => {
    if (typeof value !== "string") return [];
    const lines = value.split(/\r?\n/).flatMap(line => Array.from(segmenter.segment(line), s => s.segment.trim())).filter(Boolean);
    return lines.flatMap((text, sentence) => {
      if (/^https?:\/\/\S+$/.test(text)) return [];
      const previous = entries.get(JSON.stringify([post, sentence, text]));
      return [{post, sentence, text, kind: previous?.kind ?? "", source: previous?.source ?? ""}];
    });
  });
}

export function threadsClaimsProblem(posts: unknown, saved: unknown): string | null {
  for (const claim of threadsClaims(posts,saved)) {
    if (!claim.kind) return `${claim.post+1}번 글의 ${claim.sentence+1}번째 문장을 사실 또는 해석으로 구분해 주세요.`;
    if (claim.kind === "fact") {
      let source: URL | undefined;
      try { source = new URL(claim.source); } catch { /* Missing or incomplete source. */ }
      if (!source || !["http:", "https:"].includes(source.protocol) || source.username || source.password)
        return `${claim.post+1}번 글의 사실 문장에 원본 출처 주소를 입력해 주세요.`;
    }
  }
  return null;
}

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

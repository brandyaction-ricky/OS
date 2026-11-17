/** Archive the project, never its images or approval history. Old work cannot resume on restore. */
export const IMAGE_TRASH_REASON = "프로젝트를 휴지통으로 이동해 이전 작업 결과는 반영하지 않아요.";
export function cancelImageRenders<T extends {status:string;reason?:string;expires?:number;leaseHash?:string}>(runs:T[]|undefined):T[]|undefined {
  return runs?.map(run => ["queued","active"].includes(run.status)
    ? {...run,status:"failed",reason:IMAGE_TRASH_REASON,expires:0,leaseHash:undefined} : run);
}
export interface ImageTrashProject {id:string;title:string;version:number;archivedAt?:string|null}
export function changeDemoImageTrash<T extends {project:ImageTrashProject;renders?:{status:string}[];jobs:{status:string;currentInput?:boolean}[]}>(
  projects:T[],id:string,version:number,action:"trash"|"restore",at=new Date().toISOString()):T[] {
  const found=projects.find(row=>row.project.id===id);
  if(!found) throw new Error("프로젝트를 찾을 수 없어요.");
  if(found.project.version!==version) throw new Error("다른 창에서 바뀌었어요. 목록을 새로고침해 주세요.");
  const trash=action==="trash";
  if(trash===Boolean(found.project.archivedAt)) throw new Error("프로젝트 상태가 바뀌었어요. 목록을 새로고침해 주세요.");
  return projects.map(row=>row===found ? {...row,project:{...row.project,version:version+1,archivedAt:trash?at:null},
    ...(trash && {renders:cancelImageRenders(row.renders),jobs:row.jobs.map(job=>["backlog","active"].includes(job.status)
      ? {...job,status:"cancelled",currentInput:false} : job)})} : row);
}

/** Shared headings retain each existing address, including direct links and refreshes. */
export function meetingTabHref(tab:string,query:string){
  const params=new URLSearchParams(query);params.set("tab",tab);params.delete(tab==="decisions"?"meeting":"record");
  const path=tab==="decisions"?"/home/decisions":"/organization/meetings";
  return `${path}${params.size?`?${params}`:""}`;
}
export function scheduleTabHref(tab:string){return tab==="leave"?"/organization/leave":"/organization/schedule";}

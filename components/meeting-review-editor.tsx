"use client";
import {MEETING_TERMS, type MeetingReviewItem, type ReviewMember} from "@/lib/meeting-review";
export function MeetingReviewEditor({items,members,onChange,disabled=false}:{items:MeetingReviewItem[];members:ReviewMember[];onChange:(items:MeetingReviewItem[])=>void;disabled?:boolean}) {
 const change=(id:string,values:Partial<MeetingReviewItem>)=>onChange(items.map(item=>item.id===id?{...item,...values}:item));
 return <section className="meeting-review-editor" aria-label="추출 검수">
 <header><h3>추출 검수</h3><p>결정·업무·미결·제외를 확인하세요. 업무는 담당자와 기한을 지정해야 확정할 수 있습니다.</p></header>
 <details><summary>용어 사전</summary><p>{MEETING_TERMS.map(term=>`${term.from} → ${term.to}`).join(" · ")}</p><small>추출한 문구에만 적용합니다. 아래에서 수정할 수 있으며 회의 원문은 유지됩니다.</small></details>
 {items.map((item,index)=><article key={item.id} className={item.kind==="excluded"?"excluded":""}>
 <label>항목 {index+1} 분류<select aria-label={`항목 ${index+1} 분류`} value={item.kind} disabled={disabled} onChange={event=>change(item.id,{kind:event.target.value as MeetingReviewItem["kind"]})}><option value="decision">결정</option><option value="task">업무</option><option value="pending">미결</option><option value="excluded">제외</option></select></label>
 <label>내용<textarea aria-label={`항목 ${index+1} 내용`} value={item.title} disabled={disabled} maxLength={240} onChange={event=>change(item.id,{title:event.target.value})}/></label>
 {item.kind==="task"&&<><div className="form-grid"><label>담당자<select aria-label={`항목 ${index+1} 담당자`} value={item.assigneeId} disabled={disabled} onChange={event=>change(item.id,{assigneeId:event.target.value})}><option value="">담당자 선택</option>{members.filter(member=>member.is_active).map(member=><option key={member.id} value={member.id}>{member.display_name||member.email.split("@")[0]}</option>)}</select>{item.assigneeHint&&!item.assigneeId&&<small>추출한 이름: {item.assigneeHint} · 구성원을 직접 선택하세요.</small>}</label><label>기한<input aria-label={`항목 ${index+1} 기한`} type="date" value={item.dueDate} disabled={disabled} onChange={event=>change(item.id,{dueDate:event.target.value})}/></label></div><label>완료 기준<input aria-label={`항목 ${index+1} 완료 기준`} value={item.doneCriteria} disabled={disabled} maxLength={2000} onChange={event=>change(item.id,{doneCriteria:event.target.value})}/></label></>}
 </article>)}
 {!items.length&&<p>추출하거나 직접 추가한 항목이 이곳에 표시됩니다.</p>}
 <button type="button" className="secondary-button" disabled={disabled} onClick={()=>onChange([...items,{id:crypto.randomUUID(),kind:"decision",title:"",assigneeId:"",assigneeHint:"",dueDate:"",doneCriteria:""}])}>항목 직접 추가</button>
 </section>;
}

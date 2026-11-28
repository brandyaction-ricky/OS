"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CardSlideView } from "@/lib/cardnews/card-slide";
import { cardProblems, slideSpec, type CardDraft } from "@/lib/cardnews/formats";
import { MYIN_ART_PROMPT, MYIN_BASIS, MYIN_DESIGNS, myinExample } from "@/lib/cardnews/myin-example";
import { myinEditableSchema } from "@/lib/cardnews/myin-preview";
import { useSession } from "./session-provider";
import "./myin-card-workshop.css";
const STEPS = ["정본 확인", "내용 기획", "디자인·이미지", "내보내기"];
const KEY = "myin-card-workshop-v1";
const saveFile = (blob: Blob, name: string) => { const url=URL.createObjectURL(blob); const a=Object.assign(document.createElement("a"),{href:url,download:name}); a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000); };
type Original = { id: string; title: string; content_md: string; current_version: number };
export function MyinCardWorkshop() {
  const {demo, accessToken}=useSession();
  const [draft,setDraft]=useState<CardDraft>(myinExample), [step,setStep]=useState(0), [selected,setSelected]=useState(0), [ready,setReady]=useState(false), [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [notice,setNotice]=useState(""), [storageError,setStorageError]=useState(""), [art,setArt]=useState<string>();
  const [originals,setOriginals]=useState<Original[]>([]), [canonError,setCanonError]=useState("");
  const [pngs,setPngs]=useState<string[]>([]), [renderedKey,setRenderedKey]=useState("");
  const urls=useRef<string[]>([]), revision=useRef(0), running=useRef(false);
  useEffect(()=>{ try { const raw=localStorage.getItem(KEY); if(raw){const saved=myinEditableSchema.safeParse(JSON.parse(raw)); if(saved.success){setDraft(saved.data.draft); setArt(saved.data.art);}else setStorageError("저장된 원고 형식을 읽지 못해 제작 예시를 열었어요.");} }catch{setStorageError("기기에 저장된 내용을 읽지 못했어요. JSON으로 백업해 주세요.");} setReady(true); return()=>urls.current.forEach(url=>URL.revokeObjectURL(url)); },[]);
  useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify({draft,art}));setStorageError("");}catch{setStorageError("이 기기에 저장하지 못했어요. JSON 백업을 받아 주세요.");}},[draft,art,ready]);
  useEffect(()=>{if(demo || !accessToken)return; const controller=new AbortController(); fetch("/api/v1/content/youtube/cards?canon=1",{headers:{Authorization:`Bearer ${accessToken}`},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error("정본 원문을 불러오지 못했어요.");return r.json();}).then(v=>setOriginals(v.originals??[])).catch(e=>{if(!controller.signal.aborted)setCanonError(e.message);});return()=>controller.abort();},[demo,accessToken]);
  const key=JSON.stringify({draft,art});
  const problems=cardProblems(draft).blocking;
  const update=(next:CardDraft)=>{revision.current++;setDraft(next);setNotice("");};
  const photos=art?{"/myin-cards/work-observation.png":art}:undefined;
  const draw=(d:CardDraft,index:number,width:number)=><div className={`mw-card mw-card-size-${width}`}><div className="mw-card-canvas"><CardSlideView draft={d} index={index} photos={photos}/></div></div>;
  const request=async (payload:object)=>{const response=await fetch("/api/v1/content/youtube/cards/preview",{method:"POST",headers:{"Content-Type":"application/json",...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},body:JSON.stringify(payload)});if(!response.ok){const body=await response.json();throw Error(body.error?.message??"이미지를 만들지 못했어요.");}return response.blob();};
  const generate=async()=>{if(running.current)return;running.current=true;setBusy(true);setError("");const rev=revision.current;const next:string[]=[];try{for(let i=0;i<draft.slides.length;i++){setNotice(`${i+1}/${draft.slides.length}장 · 글자와 이미지를 PNG로 조판하고 있어요`);next.push(URL.createObjectURL(await request({draft,art,slide:i})));}if(rev!==revision.current){next.forEach(u=>URL.revokeObjectURL(u));throw Error("제작 중 원고가 바뀌었어요. 다시 생성해 주세요.");}urls.current.forEach(u=>URL.revokeObjectURL(u));urls.current=next;setPngs(next);setRenderedKey(key);setStep(3);setNotice(`${next.length}장 PNG 생성 완료 · 1080×1350`);}catch(e){next.forEach(u=>URL.revokeObjectURL(u));setNotice("");setError((e as Error).message);}finally{running.current=false;setBusy(false);}};
  const download=async(zip:boolean)=>{setBusy(true);setError("");try{saveFile(await request({draft,art,...(zip?{zip:true}:{slide:selected})}),zip?"myin-strengths-8cards.zip":`card-${String(selected+1).padStart(2,"0")}.png`);setNotice(zip?"8장 PNG와 캡션을 ZIP으로 내려받았어요.":`${selected+1}장 PNG를 내려받았어요.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const upload=async(file?:File)=>{if(!file)return;if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>8_000_000){setError("8MB 이하 PNG·JPG·WebP를 골라 주세요.");return;}setBusy(true);try{const bitmap=await createImageBitmap(file);const canvas=document.createElement("canvas");const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext("2d")!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const value=canvas.toDataURL("image/png");if(value.length>2_000_000)throw Error("그림 용량이 커요. 더 작은 이미지를 골라 주세요.");revision.current++;setArt(value);setNotice("2장 설명용 그림을 교체했어요. PNG를 다시 생성해 주세요.");setError("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const valid=checked && (demo || originals.length>=5) && !problems.length;
  const stale=renderedKey!==key;
  return <div className="mw-workshop">
    <div className="mw-heading"><div><Link href="/automation/cardnews">← 콘텐츠 제작으로</Link><p className="mw-eyebrow">MYIN CARD STUDIO</p><h1>내 경험에서, 내 강점으로.</h1><p>정본부터 완성 이미지까지. 한 장씩 확인하며 만드는 카드뉴스.</p></div><span className="mw-status">{ready?storageError?"저장 확인 필요":"이 기기에 저장됨":"불러오는 중"}</span></div>
    <div className="mw-notice">{demo?"로컬 제작 검수 · 정본 원문을 읽고 준비한 실제 8장 예시입니다. 회사 AI API를 실행한 결과로 표시하지 않습니다.":"제작 예시는 2026-11-27 원문 확인 기준입니다. 아래에서 현재 회사 정본과 비교해 주세요."} 카드뉴스 정본 v0.3 · 디자인 정본 문서 v2 기준입니다.</div>
    <nav className="mw-steps" aria-label="카드뉴스 제작 단계">{STEPS.map((label,i)=><button key={label} disabled={busy||i>0&&!checked||i===3&&!pngs.length} aria-current={step===i?"step":undefined} onClick={()=>setStep(i)}><span>{i+1}</span>{label}</button>)}</nav>
    {(error||storageError||canonError)&&<p role="alert" className="mw-error">{error||storageError||canonError}</p>}
    {notice&&<p role="status" className="mw-notice">{notice}</p>}
    {step===0&&<section className="mw-panel"><div className="mw-section-title"><div><small>01 · SOURCE</small><h2>어떤 기준으로 만들까요?</h2><p>읽은 정본과 이번 원고에 적용한 기준을 함께 확인해요.</p></div><span>원문 확인 · 2026.11.27</span></div>
      <div className="mw-sources">{MYIN_BASIS.map(row=>{const original=originals.find(d=>d.title.startsWith(row.title));return <article key={row.title}><h3>{row.title}</h3><small>{original?`현재 문서 v${original.current_version}`:row.version}</small><p>{row.section}</p>{original&&<details><summary>현재 원문 열기</summary><pre>{original.content_md}</pre><Link href={`/knowledge/doc/${original.id}`}>회사 문서에서 열기 ↗</Link></details>}</article>;})}</div>
      <div className="mw-rule"><b>이번 콘텐츠의 독자</b><p>오래 일했지만 내 강점을 설명하기 어려운 사람. 경험에서 반복한 행동·도움·조건을 찾아 다음 일에서 확인합니다.</p><small>회의 장면은 설명용 예시입니다. 개인의 강점·맞는 직업·진단 결과를 단정하지 않습니다.</small></div>
      <label className="mw-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>제작 기준과 사례·견본 표시를 확인했어요</label>
      <div className="mw-actions"><button className="mw-primary" disabled={!checked||!ready} onClick={()=>setStep(1)}>8장 내용 기획 보기 →</button></div>
    </section>}
    {step===1&&<section className="mw-panel"><div className="mw-section-title"><div><small>02 · STORY</small><h2>한 장에 한 가지씩 전해요</h2><p>질문 → 업무 장면 → 행동·도움·조건 → 욕구 → 경험 기록 → 다음 행동</p></div><span>8장 · 정리형</span></div>
      <label className="mw-field">작업 주제<input value={draft.workTitle} maxLength={200} onChange={e=>update({...draft,workTitle:e.target.value})}/><small>주제를 바꾸면 아래 원고도 직접 고쳐 주세요. 제목만 바꿔서 다른 주제의 AI 결과로 만들지 않아요.</small></label>
      <div className="mw-plan">{draft.slides.map((slide,index)=><article key={index}><div className="mw-plan-number">{String(index+1).padStart(2,"0")}<small>{slideSpec(draft.format,slide.type)?.label}</small></div><div className="mw-plan-fields">{slideSpec(draft.format,slide.type)?.fields.filter(f=>slide.fields[f.key]!==undefined).map(f=><label key={f.key} className="mw-field"><span>{f.label}<small>{[...slide.fields[f.key]].length}/{f.max}</small></span><textarea rows={f.key==="worksheet"?3:2} value={slide.fields[f.key]} onChange={e=>update({...draft,slides:draft.slides.map((s,i)=>i===index?{...s,fields:{...s.fields,[f.key]:e.target.value}}:s)})}/></label>)}</div></article>)}</div>
      {problems.length>0&&<ul className="mw-error">{problems.map(p=><li key={p}>{p}</li>)}</ul>}
      <details><summary>게시용 캡션·해시태그</summary><label className="mw-field">캡션<textarea rows={9} value={draft.caption} onChange={e=>update({...draft,caption:e.target.value})}/></label><p>{draft.hashtags.map(t=>"#"+t).join(" ")}</p></details>
      <div className="mw-actions"><button onClick={()=>setStep(0)}>← 정본 확인</button><button className="mw-primary" disabled={!!problems.length} onClick={()=>setStep(2)}>원고 확인 · 디자인 선택 →</button></div>
    </section>}
    {step===2&&<section className="mw-panel"><div className="mw-section-title"><div><small>03 · DESIGN</small><h2>같은 내용, 세 가지 첫인상</h2><p>캐릭터와 보고서 원본을 살리고 정확한 글자를 따로 배치합니다.</p></div><span>1080 × 1350</span></div>
      <div className="mw-designs">{MYIN_DESIGNS.map(d=><button key={d.id} aria-pressed={draft.production?.design===d.id} disabled={busy} onClick={()=>update({...draft,production:{...draft.production!,design:d.id}})}>{draw({...draft,production:{...draft.production!,design:d.id}},0,210)}<strong>{d.name}</strong><small>{d.detail}</small></button>)}</div>
      <div className="mw-art"><div><h3>이미지 제작 자료</h3><ul><li>캐릭터 · 제공된 원본 유지</li><li>보고서 · MYIN 공식 홈페이지 공개 견본</li><li>업무 소품 · 이번 제작에서 생성한 설명용 그림</li></ul><a href="/myin-cards/work-observation.png" target="_blank" rel="noreferrer">생성한 그림 원본 보기 ↗</a><details><summary>그림 생성 요청문</summary><pre>{MYIN_ART_PROMPT}</pre><button disabled={busy} onClick={()=>saveFile(new Blob([MYIN_ART_PROMPT],{type:"text/plain;charset=utf-8"}),"myin-image-prompt.txt")}>요청문 받기</button><p>새 그림이 필요하면 ChatGPT에 요청문을 보내고 받은 이미지를 아래에서 넣어요. 회사 API 생성은 기존 카드 제작 화면에서 사용할 수 있어요.</p></details></div><label className="mw-upload">2장 설명용 그림 교체<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value="";}}/><small>캐릭터 원본과 보고서 견본은 유지합니다.</small></label></div>
      <div className="mw-strip" aria-label="전체 장 미리보기">{draft.slides.map((_,i)=><button key={i} onClick={()=>setSelected(i)} aria-pressed={selected===i}>{draw(draft,i,124)}<span>{i+1}장</span></button>)}</div>
      <div className="mw-inspect">{draw(draft,selected,300)}<div><h3>{selected+1}장 미리보기</h3><p>원고와 그림을 확인한 다음 PNG를 만드세요.</p><p>선택한 디자인과 편집한 글자가 최종 이미지에 반영됩니다.</p><button onClick={()=>setStep(1)} disabled={busy}>원고 수정으로 돌아가기</button></div></div>
      <div className="mw-actions"><button disabled={busy} onClick={()=>setStep(1)}>← 내용 기획</button><button className="mw-primary" disabled={busy||!valid} onClick={()=>void generate()}>{busy?"PNG 만드는 중…":"8장 PNG 생성 →"}</button></div>
    </section>}
    {step===3&&<section className="mw-panel"><div className="mw-section-title"><div><small>04 · EXPORT</small><h2>8장 카드뉴스가 완성됐어요</h2><p>장별 PNG와 캡션을 묶어 저장할 수 있어요.</p></div><span>업로드·게시 전 검토용</span></div>
      {stale&&<p className="mw-error">원고나 디자인이 바뀌었어요. 아래 이미지는 이전 생성본입니다. 다시 생성한 뒤 내려받으세요.</p>}
      <div className="mw-exports">{pngs.map((url,i)=><button key={i} aria-pressed={selected===i} onClick={()=>setSelected(i)}><img src={url} alt={`${i+1}장 생성된 카드뉴스`} width={216} height={270}/><span>{i+1}장</span></button>)}</div>
      <div className="mw-actions"><button disabled={busy} onClick={()=>setStep(2)}>← 디자인 수정</button>{stale?<button className="mw-primary" disabled={busy||!valid} onClick={()=>void generate()}>수정본 다시 생성</button>:<><button disabled={busy} onClick={()=>void download(false)}>{selected+1}장 PNG</button><button className="mw-primary" disabled={busy} onClick={()=>void download(true)}>전체 PNG + 캡션 ZIP 받기</button></>}</div>
    </section>}
    <footer className="mw-bottom"><label>편집 원본 복원<input type="file" accept="application/json,.json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{if(file.size>2_100_000)throw Error("원본 파일은 2MB 이하로 넣어 주세요.");const result=myinEditableSchema.safeParse(JSON.parse(await file.text()));if(!result.success)throw Error("지원하는 편집 원본 형식이 아니에요.");saveFile(new Blob([JSON.stringify({draft,art},null,2)],{type:"application/json"}),"myin-before-restore.json");revision.current++;setDraft(result.data.draft);setArt(result.data.art);setStep(1);setNotice("기존 내용을 백업하고 편집 원본을 복원했어요.");setError("");}catch(err){setError((err as Error).message);}}}/></label><span>저장은 이 브라우저에 적용됩니다. 다른 기기로 옮길 때는 편집 원본을 받아 주세요.</span><button disabled={busy} onClick={()=>saveFile(new Blob([JSON.stringify({draft,art},null,2)],{type:"application/json"}),"myin-cardnews-editable.json")}>편집 원본 JSON 받기</button></footer>
  </div>;
}

"use client";

import {createContext, useContext, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {$getSelection, $isRangeSelection, $isTextNode, $getNodeByKey, KEY_DOWN_COMMAND, COMMAND_PRIORITY_CRITICAL} from "lexical";
import {addComposerChild$, realmPlugin} from "@mdxeditor/editor";

export interface InlineChoice {id:string; title:string; detail?:string; disabled?:boolean}
export interface InlineOptions {
  documents:InlineChoice[];
  people:InlineChoice[];
  createDocument?:(title:string)=>Promise<string|undefined>;
  onMention?:(name:string)=>void;
  onDocumentQuery?:(query:string)=>void;
  onError:(message:string)=>void;
}
export const KnowledgeInlineOptions = createContext<InlineOptions|undefined>(undefined);
type Match = {key:string; start:number; end:number; query:string; kind:"document"|"person"; left:number; top:number};

/** A Lexical range, rather than DOM mutation, keeps undo and Korean IME intact. */
function InlinePicker() {
  const [editor] = useLexicalComposerContext();
  const options = useContext(KnowledgeInlineOptions);
  const [match,setMatch] = useState<Match|null>(null), [index,setIndex] = useState(0), [busy,setBusy] = useState(false);
  const dismissed = useRef("");
  const previousQuery = useRef("");
  const signature = (m:Match)=>`${m.key}:${m.start}:${m.end}:${m.query}`;
  const onDocumentQuery = options?.onDocumentQuery;
  useEffect(() => { if (match?.kind === "document") onDocumentQuery?.(match.query); }, [match?.kind, match?.query, onDocumentQuery]);
  useEffect(()=>editor.registerUpdateListener(({editorState})=>{
    if(editor.isComposing())return;
    editorState.read(()=>{
      const selection=$getSelection();
      if(!$isRangeSelection(selection)||!selection.isCollapsed()){setMatch(null);return;}
      const node=selection.anchor.getNode();
      if(!$isTextNode(node)||node.getParent()?.getType()==="code"){setMatch(null);return;}
      const prefix=node.getTextContent().slice(0,selection.anchor.offset);
      const link=prefix.match(/\[\[([^\]\n]{0,30})$/), person=prefix.match(/(?:^|\s)@([^\s@{}]{0,30})$/);
      const found=link??person;
      if(!found||found[1].includes("  ")){setMatch(null);return;}
      const kind=link?"document":"person", length=found[1].length+(link?2:1);
      const range=window.getSelection();
      const caret=range?.rangeCount?range.getRangeAt(0).getBoundingClientRect():null;
      const next:Match={key:node.getKey(),start:selection.anchor.offset-length,end:selection.anchor.offset,query:found[1],kind,left:Math.max(8,Math.min(caret?.left??8,innerWidth-312)),top:Math.max(8,Math.min((caret?.bottom??40)+6,innerHeight-300))};
      if(signature(next)===dismissed.current)return;
      const queryKey=`${next.kind}:${next.query}`;
      if(previousQuery.current!==queryKey){previousQuery.current=queryKey;setIndex(0);}
      setMatch(next);
    });
  }),[editor]);
  const choices=(match?.kind==="person"?options?.people:options?.documents)?.filter(row=>row.title.toLocaleLowerCase().includes(match?.query.toLocaleLowerCase()??"")).slice(0,20)??[];
  const canCreate=match?.kind==="document"&&Boolean(options?.createDocument);
  function close(){if(match)dismissed.current=signature(match);setMatch(null);}
  async function choose(choice?:InlineChoice){
    if(!match||!options||busy||choice?.disabled)return;
    const selected={...match};setBusy(true);
    try{
      const id=choice?.id??await options.createDocument?.(selected.query.trim()||"새 문서");
      if(!id)return;
      let inserted=false;
      editor.update(()=>{
        const node=$getNodeByKey(selected.key);
        const expected=(selected.kind==="document"?"[[":"@")+selected.query;
        // Async creation must not overwrite text edited or moved in the meantime.
        if(!$isTextNode(node)||node.getTextContent().slice(selected.start,selected.end)!==expected)return;
        node.select(selected.start,selected.end);
        const selection=$getSelection();
        if($isRangeSelection(selection)){
          selection.insertText(selected.kind==="document"?`[[${id}]] `:`@{${id}|${choice!.title.replace(/[|{}]/g,"")}} `);
          inserted=true;
        }
      },{discrete:true});
      if(!inserted)throw Error("문서는 만들었지만 입력 위치가 바뀌었습니다. 문서 연결에서 다시 선택해 주세요.");
      if(selected.kind==="person")options.onMention?.(choice!.title);
      close();
    }catch(error){options.onError((error as Error).message);}finally{setBusy(false);}
  }
  const live=useRef({match,index,choices,canCreate,choose,close});live.current={match,index,choices,canCreate,choose,close};
  useEffect(()=>editor.registerCommand(KEY_DOWN_COMMAND,event=>{
    const value=live.current;if(!value.match||event.isComposing||editor.isComposing())return false;
    if(event.key==="Escape"){event.preventDefault();value.close();return true;}
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();setIndex(i=>Math.max(0,Math.min(value.choices.length-1+Number(value.canCreate),i+(event.key==="ArrowDown"?1:-1))));return true;
    }
    if(event.key==="Enter"||event.key==="Tab"){
      event.preventDefault();if(value.choices[value.index]||value.canCreate)void value.choose(value.choices[value.index]);return true;
    }
    return false;
  },COMMAND_PRIORITY_CRITICAL),[editor]);
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{if(!(event.target as Element).closest(".kw-inline-suggestions"))live.current.close();};
    document.addEventListener("pointerdown",dismiss);return()=>document.removeEventListener("pointerdown",dismiss);
  },[]);
  if(!match||!options)return null;
  return createPortal(<div className="kw-inline-suggestions" role="listbox" aria-label={match.kind==="document"?"문서 연결 제안":"사람 언급"} style={{left:match.left,top:match.top}}>
    <strong>{match.kind==="document"?"문서 연결":"사람 언급"}</strong><small>↑↓ 선택 · Enter/Tab 삽입 · Esc 닫기</small>
    {choices.map((row,i)=><button type="button" role="option" aria-selected={i===index} disabled={row.disabled||busy} key={row.id} onMouseDown={e=>e.preventDefault()} onClick={()=>void choose(row)}><span>{row.title}</span><small>{row.disabled?"이 문서를 볼 수 없음":row.detail}</small></button>)}
    {canCreate&&<button type="button" role="option" aria-selected={index===choices.length} disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>void choose()}>+ {match.query||"새 문서"} 만들고 연결</button>}
    {!choices.length&&!canCreate&&<p>일치하는 사람이 없습니다</p>}
  </div>,document.body);
}
export const knowledgeInlinePickerPlugin=realmPlugin({init(realm){realm.pub(addComposerChild$,InlinePicker);}});

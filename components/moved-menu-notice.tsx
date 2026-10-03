"use client";
import {useSearchParams} from "next/navigation";
import {useEffect,useState} from "react";
import {RETIRED_ROUTES} from "@/lib/final-routes";
export function MovedMenuNotice() {
  const name=useSearchParams().get("moved")??"";
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!Object.values(RETIRED_ROUTES).includes(name)){setVisible(false);return;}
    try {setVisible(sessionStorage.getItem(`brandy-os-moved:${name}`)!=="seen");} catch {setVisible(true);}
  },[name]);
  if(!visible)return null;
  return <section className="menu-guide" role="status"><span>{name}: 정리된 메뉴입니다 — 데이터는 보관돼 있습니다.</span><button className="secondary-button" onClick={()=>{setVisible(false);try{sessionStorage.setItem(`brandy-os-moved:${name}`,"seen");}catch{/* In-memory dismissal remains available. */}}}>확인</button></section>;
}

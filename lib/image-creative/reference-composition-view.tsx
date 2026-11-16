import type { CSSProperties } from "react";
import { composeReference, type CompositionInput } from "./reference-composition.ts";

const rect = ({x,y,w,h}:{x:number;y:number;w:number;h:number}):CSSProperties => ({position:"absolute", display:"flex",left:x,top:y,width:w,height:h});
function foreground(hex: string) {
  const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722 > .179 ? "#000000" : "#ffffff";
}
export function ReferenceCompositionView({ variant, assetUrl }: {variant:CompositionInput;assetUrl?:string}) {
  const layout = variant.referenceLayout;
  const composition = layout.composition!;
  const plan = composeReference(variant);
  const {width,height,edge,photo,style,align} = plan;
  const overlay = style === "overlay";
  const ink = overlay ? "#ffffff" : composition.ink;
  const customFont = variant.design?.font && !["original","sans"].includes(variant.design.font);
  let imageBox = photo;
  if (photo && variant.asset) {
    const scale = (composition.fit === "cover" ? Math.max : Math.min)(photo.w/variant.asset.w, photo.h/variant.asset.h);
    const w = variant.asset.w * scale, h = variant.asset.h * scale;
    const fx = composition.fit === "cover" ? composition.focusX ?? 50 : 50;
    const fy = composition.fit === "cover" ? composition.focusY ?? 50 : 50;
    imageBox = {x:(photo.w-w)*fx/100,y:(photo.h-h)*fy/100,w,h};
  }
  const family = customFont ? `Ad-${variant.design!.font}, Pretendard` : "Pretendard";
  const alignItems = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  const unit = width/1080;
  const textLayers = (["headline","body","cta"] as const).map(role=>{
    const {box,lines,fontSize,lineHeight} = plan[role];
    if (!lines.length) return null;
    const button = role === "cta";
    const link = button && composition.buttonStyle === "text";
    return <div key={role} data-image-field={role} style={{...rect(box),flexDirection:"column",alignItems:button && !link ? "center" : alignItems,justifyContent:"center",
      color:button && !link ? foreground(composition.accent) : ink, fontFamily:role === "headline" ? family : "Pretendard",
      fontSize,fontWeight:role === "headline" && !customFont ? composition.headlineWeight ?? 900 : role === "body" ? 400 : 600,
      ...(button && !link && {borderRadius:composition.buttonStyle === "square" ? 0 : box.h/2,backgroundColor:composition.accent})}}>
      {lines.map((line,index)=><div key={index} style={{display:"flex",whiteSpace:"pre",height:fontSize*lineHeight,lineHeight,...(link && {borderBottom:`2px solid ${ink}`})}}>{line || " "}</div>)}
    </div>;
  });
  return <div data-image-composition={style} style={{position:"relative",display:"flex",width,height,overflow:"hidden",backgroundColor:edge ? (variant.design?.card === "paper" ? "#ded7c9" : "#222222") : composition.background}}>
    <div style={{...rect({x:edge,y:edge,w:width-edge*2,h:height-edge*2}),backgroundColor:composition.background}}/>
    {photo && imageBox && assetUrl && <div style={{...rect(photo),alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the browser and Mac read the same owned asset */}
      <img alt="" src={assetUrl} style={{...rect(imageBox),maxWidth:imageBox.w,objectFit:"fill"}}/>
    </div>}
    {overlay && <div style={{...rect(photo!), backgroundImage:`linear-gradient(${composition.imageSide === "start" ? "60deg" : "120deg"}, rgba(8,12,20,.96) 0%, rgba(8,12,20,.87) 28%, rgba(8,12,20,.42) 57%, rgba(8,12,20,0) 86%)`}}/>}
    {style === "split" && photo && <div style={{...rect({x:photo.x+(composition.imageSide === "start" ? photo.w : -2*unit),y:photo.y,w:2*unit,h:photo.h}),backgroundColor:composition.accent}}/>}
    {textLayers}
  </div>;
}

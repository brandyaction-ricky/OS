import type { CSSProperties } from "react";
import { ReferenceCompositionView } from "./reference-composition-view.tsx";
import type { CreativeVariant } from "./model.ts";
import { resolvePlacement } from "./placement.ts";
import { referenceBodyParts, referenceMasterFrame, referenceTextKeys, referenceTextLines, usesReferenceDetailAsset, type ReferenceBox, type ReferenceTextBox, type ReferenceSample } from "./reference-layout.ts";

// Emphasize the closing phrase. In a question leave the final, often repeated question word in normal ink.
function accentHeadline(lines: string[], color: string) {
  const title = lines.join("\n");
  const words = Array.from(title.matchAll(/\S+/gu));
  if (!words.length) return lines;
  const last = words.length - (words.length > 1 && /[?？]$/u.test(title) ? 2 : 1);
  const start = words[words.length > 3 && last > 0 ? last-1 : last].index!;
  const end = words[last].index! + words[last][0].length;
  let position = 0;
  return lines.map(line => {
    const left = Math.max(0,start-position), right = Math.min(line.length,end-position);
    position += line.length+1;
    if (right <= left) return line;
    return <>{line.slice(0,left)}<span style={{color,whiteSpace:"pre"}}>{line.slice(left,right)}</span>{line.slice(right)}</>;
  });
}

export function ReferenceImageView({ variant, referenceUrl, assetUrl, detailUrl }: { variant: CreativeVariant; referenceUrl?: string; assetUrl?: string; detailUrl?: string }) {
  const layout = variant.referenceLayout;
  if (!layout || !referenceUrl || (!!layout.photo !== !!assetUrl)) throw new Error("레퍼런스 원본과 교체할 사진을 확인해 주세요.");
  const detailAsset = variant.detailAsset;
  const needsDetailAsset = usesReferenceDetailAsset(layout);
  if (needsDetailAsset !== Boolean(detailAsset) || needsDetailAsset !== Boolean(detailUrl)) throw new Error("디테일 칸에 사용할 이미지를 확인해 주세요.");
  if (layout.composition) return <ReferenceCompositionView variant={{...variant,referenceLayout:layout}} assetUrl={assetUrl}/>;
  const spec = resolvePlacement(variant.size, variant.design?.placement, variant.design?.outputWidth);
  const { width, height, safe } = spec;
  const sourceW = 1080, sourceH = sourceW * layout.source.h / layout.source.w;
  const card = variant.design?.card ?? "original";
  const pad = card === "original" ? 0 : width * .025;
  const master = layout.master;
  let fit = Math.min((width-2*pad)/sourceW, (height-2*pad)/sourceH);
  let x = (width-sourceW*fit)/2, y = (height-sourceH*fit)/2;
  function visibleText(box: ReferenceTextBox): ReferenceTextBox {
    const artW = sourceW * fit, artH = sourceH * fit;
    const left = Math.max(box.x, (safe.x-x)*100/artW), top = Math.max(box.y, (safe.y-y)*100/artH);
    return { ...box, x:left, y:top,
      w:Math.min(box.x+box.w, (safe.x+safe.width-x)*100/artW)-left,
      h:Math.min(box.y+box.h, (safe.y+safe.height-y)*100/artH)-top };
  }
  // Keep full-bleed decoration. A partly protected slot can keep its background and move only its text inside.
  const needsInset = !!master || referenceTextKeys.some(key => {
    const box = layout[key], value = variant.copy[key];
    if (!box || !value) return false;
    const ink = visibleText(box);
    return ink.w * sourceW / 100 * .96 < box.fontSize ||
      referenceTextLines(ink,value).length * box.fontSize * 1.2 > ink.h * sourceH / 100 + .000001;
  });
  if (needsInset) {
    const frame = referenceMasterFrame(layout,spec,pad);
    fit = frame.scale; x = frame.x; y = frame.y;
  }
  const artW = sourceW * fit, artH = sourceH * fit;
  const original:CSSProperties = {position:"absolute",left:x,top:y,width:artW,height:artH,objectFit:"fill"};
  const rect = (box:ReferenceBox):CSSProperties => ({position:"absolute",display:"flex",left:x+artW*box.x/100,top:y+artH*box.y/100,width:artW*box.w/100,height:artH*box.h/100});
  function originalPatch(box: ReferenceBox, sample: ReferenceSample, index:number) {
    // A flip maps the right edge of the sampled rectangle to its destination's left edge.
    const left = sample.flipX ? artW*((sample.x+box.w)/100-1) : -artW*sample.x/100;
    return <div key={index} style={{...rect(box),overflow:"hidden"}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- same decoded source as the full sheet in both renderers */}
      <img alt="" src={referenceUrl} style={{position:"absolute",left,top:-artH*sample.y/100,width:artW,height:artH,maxWidth:artW,
        objectFit:"fill",...(sample.flipX ? {transform:"scaleX(-1)"} : {})}}/>
    </div>;
  }
  const font = variant.design?.font;
  const family = !font || font === "original" || font === "sans" ? "Pretendard" : "Ad-"+font+", Pretendard";
  const photo = layout.photo;
  const contained = master?.photoFit === "contain";
  let photoStyle:CSSProperties = {width:"100%",height:"100%",objectFit:"cover"};
  if (master && photo && variant.asset) {
    const w = artW*photo.w/100, h = artH*photo.h/100;
    const scale = contained ? .91*Math.min(w/variant.asset.w,h/variant.asset.h) : Math.max(w/variant.asset.w,h/variant.asset.h);
    const width = variant.asset.w*scale, height = variant.asset.h*scale;
    const align = master.photoAlign ?? (master.keepOverPhoto?.length ? "center" : "top");
    photoStyle = {position:"absolute",left:(w-width)/2,top:contained || align==="center" ? (h-height)/2 : 0,
      width,height,maxWidth:width,objectFit:"fill",...(contained && {borderRadius:6*fit,boxShadow:`0 ${6*fit}px ${14*fit}px rgba(0,0,0,0.32)`})};
  }
  const body = referenceBodyParts(layout,variant.copy.body);
  const layers:{key:(typeof referenceTextKeys)[number] | "brand";box:ReferenceTextBox;value:string}[] = referenceTextKeys.flatMap(key=>{
    const target = layout[key];
    if (!target) return [];
    const first = {key,box:target,value:key==="body" ? body[0] : variant.copy[key]};
    return key==="body" && master?.bodyContinuation ? [first,{key,box:master.bodyContinuation,value:body[1]}] : [first];
  });
  for (const box of master?.brandSlots ?? []) layers.push({key:"brand",box,value:variant.brand ?? ""});
  const hasDetails = Boolean(master?.detailSlots?.length);
  return <div data-image-master={master?.v} style={{display:"flex",position:"relative",width,height,backgroundColor:card==="paper"?"#e8decf":card==="frame"?"#242424":master?.background ?? "#ffffff"}}>
    {/* eslint-disable-next-line @next/next/no-img-element -- the browser and the Mac consume the identical registered raster */}
    {master?.base === "solid" ? <div style={{...original,backgroundColor:master.background}}/> : <img alt="" src={referenceUrl} style={original}/>}
    {photo && assetUrl && <div style={{...rect(photo),backgroundColor:master?.background ?? "#ffffff",overflow:"hidden",
      ...(contained && {backgroundImage:`radial-gradient(ellipse at 50% 42%, rgba(255,255,255,0.20) 0%, transparent 75%)`})}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- already normalized by the renderer */}
      <img alt="" src={assetUrl} style={photoStyle}/>
    </div>}
    {photo && master?.keepOverPhoto?.map((box,index)=>{
      // Clip the full sheet in its original coordinate system. Repositioning a smaller
      // clipped child independently can round fractional offsets differently at export.
      const radius=Math.min(artW*box.w/100,artH*box.h/100)*(box.radius ?? 0)/100;
      const clipPath=`inset(${box.y}% ${100-box.x-box.w}% ${100-box.y-box.h}% ${box.x}% round ${radius}px)`;
      /* eslint-disable-next-line @next/next/no-img-element -- keeps original same-position foreground pixels */
      return <img key={index} alt="" src={referenceUrl} style={{...original,clipPath}}/>;
    })}
    {master?.regions.map((region,index)=>region.sample ? originalPatch(region,region.sample,index) :
      <div key={index} style={{...rect(region),backgroundColor:region.fill}}/>)}
    {hasDetails && layers.map(({box},i) => box.fill !== "transparent" &&
      <div key={i} style={{...rect(box),backgroundColor:box.fill}}/>)}
    {master?.detailSlots?.map((slot,index)=>{
      const image = slot.source === "photo" ? variant.asset : detailAsset;
      const url = slot.source === "photo" ? assetUrl : detailUrl;
      if (!image || !url) throw new Error("디테일에 사용할 이미지를 확인해 주세요.");
      const width = artW*slot.w/100, height = artH*slot.h/100;
      const crop = slot.crop;
      const cropW = image.w*crop.w/100, cropH = image.h*crop.h/100;
      const scale = slot.fit === "cover" ? Math.max(width/cropW,height/cropH) : Math.min(width/cropW,height/cropH);
      const w = cropW*scale, h = cropH*scale;
      // Clip the crop itself as well as the slot. Adjacent sheet artwork must never bleed into contain margins.
      return <div key={index} data-image-detail={index+1} style={{...rect(slot),overflow:"hidden",borderRadius:Math.min(width,height)*(slot.radius ?? 0)/100}}>
        <div style={{position:"absolute",display:"flex",overflow:"hidden",left:(width-w)/2,top:(height-h)/2,width:w,height:h}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- crop an actual project image, preserving its alpha */}
          <img alt="" src={url} style={{position:"absolute",objectFit:"fill",left:-image.w*scale*crop.x/100,top:-image.h*scale*crop.y/100,
            width:image.w*scale,maxWidth:image.w*scale,height:image.h*scale}}/>
        </div>
      </div>;
    })}
    {layers.map(({key,box,value},index) => {
      const fontSize = box.fontSize * fit;
      const ink = master ? box : visibleText(box);
      const lines = referenceTextLines(ink,value, master ? key==="brand" ? "cta" : key : undefined);
      const colored = key==="headline" && master?.headlineAccent ? accentHeadline(lines,master.headlineAccent) : lines;
      return <div key={index} style={{...rect(box),overflow:"hidden",backgroundColor:hasDetails ? "transparent" : box.fill}}>
        {value && <div data-image-field={key} style={{position:"absolute",left:artW*(ink.x-box.x)/100,top:artH*(ink.y-box.y)/100,
          width:artW*ink.w/100,height:artH*ink.h/100,display:"flex",flexDirection:"column",justifyContent:"center",overflow:"hidden",color:box.color,
          fontSize,fontFamily:family,fontWeight:box.weight ?? (key==="body"?400:key==="headline" && master ? master.headlineWeight : 600),paddingLeft:artW*ink.w*.0002,paddingRight:artW*ink.w*.0002}}>
          {colored.map((line,index)=><div key={index} style={{display:"flex",width:"100%",height:fontSize*1.2,lineHeight:1.2,whiteSpace:"pre",
            justifyContent:box.align==="center"?"center":box.align==="right"?"flex-end":"flex-start"}}>{line || " "}</div>)}
        </div>}
      </div>;
    })}
  </div>;
}

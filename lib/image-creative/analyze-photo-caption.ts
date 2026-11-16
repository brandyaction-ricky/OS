import { isReferenceLayout, type ReferenceLayout, type ReferenceTextBox } from "./reference-layout.ts";

type Band = {top:number; bottom:number; left:number; right:number};
const height = (band:Band) => band.bottom - band.top + 1;
const hex = (rgb:number) => "#" + rgb.toString(16).padStart(6, "0");

/** Recognize a masthead, photograph, bold multiline caption and separate footer link.
 * The original photograph can contain its own lettering. Replace the entire photo field. */
export function photoCaptionLayout(rgba:Uint8ClampedArray, w:number, h:number, initial:ReferenceLayout, brand?:string):ReferenceLayout | undefined {
  if (w < 80 || h < 80 || !initial.photo) return;
  const bands:Band[] = [];
  const plate = [rgba[0],rgba[1],rgba[2]];
  if (Math.max(...plate)>80) return;
  const headerCoverage:number[] = [];
  let textured=0, measured=0, dark=0;
  for (let y=0;y<h;y++) {
    let first=w, last=0, marks=0, runs=0, near=0, previous=false;
    for (let x=0;x<w;x++) {
      const i=4*(w*y+x), r=rgba[i], g=rgba[i+1], b=rgba[i+2];
      const bright = .21*r+.72*g+.07*b>164;
      if (bright) {
        first=Math.min(first,x); last=x; marks++;
        if (!previous) runs++;
      }
      previous=bright;
      if (y<h*.22 && Math.max(Math.abs(r-plate[0]),Math.abs(g-plate[1]),Math.abs(b-plate[2]))<8) near++;
      if (x>0 && y>h*.2 && y<h*.55) {
        measured++;
        if (Math.max(r,g,b)<115) dark++;
        if (Math.abs(r-rgba[i-4])+Math.abs(g-rgba[i-3])+Math.abs(b-rgba[i-2])>32) textured++;
      }
    }
    if (y<h*.22) headerCoverage.push(near/w);
    if (runs<3 || marks<w*.03 || last-first<w*.13) continue;
    const prior=bands.at(-1);
    if (prior && y-prior.bottom<=2) {
      prior.bottom=y; prior.left=Math.min(prior.left,first); prior.right=Math.max(prior.right,last);
    } else bands.push({top:y,bottom:y,left:first,right:last});
  }
  if (textured<measured*.035 || dark<measured*.6) return;
  const header=bands.find(b=>b.top<h*.12 && height(b)>=h*.012 && height(b)<=h*.065);
  if (!header) return;
  const headerEnd=headerCoverage.findIndex((coverage,y)=>y>header.bottom && coverage<.6 && headerCoverage[y+1]<.6);
  if (headerEnd<0 || headerEnd>h*.2 || headerCoverage.slice(0,header.top).filter(coverage=>coverage>.8).length<header.top*.8) return;
  const lower=bands.filter(b=>b.top>h*.49 && b.right-b.left>w*.24 && height(b)>=h*.012);
  const footer=lower.at(-1);
  if (!footer || footer.top<h*.79 || footer.bottom>=h-1) return;
  const title=lower.filter(b=>b!==footer && height(b)>=height(footer)*1.4 && height(b)>=h*.026);
  if (title.length<2 || title.length>3 || title.some((b,i)=>i>0 && b.top-title[i-1].bottom>height(b)*1.5)) return;
  const [first]=title, last=title[title.length-1];
  if (footer.top-last.bottom<h*.052) return;
  // Sample type colour only inside the measured caption. Photo lights must not supply the accent.
  const colors=new Map<number,number>();
  for (const line of title) for (let y=line.top;y<=line.bottom;y++) for (let x=line.left;x<=line.right;x++) {
    const i=4*(w*y+x), r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    if (Math.max(r,g,b)-Math.min(r,g,b)<54 || .21*r+.72*g+.07*b<135) continue;
    const rgb=((r&248)<<16)|((g&248)<<8)|(b&248);
    colors.set(rgb,(colors.get(rgb)??0)+1);
  }
  const accent=[...colors].sort((a,b)=>b[1]-a[1])[0];
  const pct=(amount:number,dimension:number)=>Math.round(10000*amount/dimension)/100;
  const py=(amount:number)=>pct(amount,h);
  const unit=1080/w;
  const left=pct(Math.min(...title.map(b=>b.left)),w);
  const right=pct(w-1-Math.max(...title.map(b=>b.right)),w);
  const align:ReferenceTextBox["align"] = Math.abs(left-right)<5 ? "center" : left<right ? "left":"right";
  const margin=Math.max(4,Math.min(12,Math.min(left,right)));
  const headY=py(first.top-height(first)*.48);
  const headEnd=py(last.bottom+1);
  const ctaBottom=py(Math.min(h,footer.bottom+height(footer)*.6+1));
  const ctaTop=py(footer.top-height(footer)*.6);
  const sourceHeight=h*unit;
  const text=(y:number,end:number,fontSize:number,alignment:ReferenceTextBox["align"]):ReferenceTextBox=>({
    x:margin,y,w:100-2*margin,h:end-y,color:"#ffffff",fill:"transparent",fontSize,align:alignment,
  });
  const font=(limit:number,target:number)=>Math.max(12,Math.min(Math.floor(limit),Math.round(target)));
  const titleSize=font((headEnd-headY)*sourceHeight/(100*1.2*title.length),height(first)*unit);
  const bodySize=font((ctaTop-headEnd)*sourceHeight/120,height(footer)*unit*.83);
  const headerHeight=py(headerEnd);
  const brandSize=font(headerHeight*sourceHeight/120,height(header)*unit*1.1);
  const bgOffset=4*((h-1)*w);
  const background=hex((rgba[bgOffset]<<16)|(rgba[bgOffset+1]<<8)|rgba[bgOffset+2]);
  const ctaAlign=footer.left>w*.3 ? "right":footer.right<w*.7 ? "left":"center";
  const layout:ReferenceLayout = {
    source:initial.source,photo:{x:0,y:headerHeight,w:100,h:headY-headerHeight},
    headline:text(headY,headEnd,titleSize,align),
    body:text(headEnd,ctaTop,bodySize,align),
    cta:{...text(ctaTop,ctaBottom,font((ctaBottom-ctaTop)*sourceHeight/120,height(footer)*unit*1.12),ctaAlign),weight:900},
    master:{v:1,base:"solid",background,headlineWeight:900,photoAlign:"center",photoFit:"contain",
      ...(accent && accent[1]>=w*.04 && {headlineAccent:hex(accent[0])}),
      ...(brand?.trim() && {brandSlots:[{...text(0,headerHeight,brandSize,"left"),weight:900}]}),
      regions:[
        {x:0,y:0,w:100,h:headerHeight,fill:hex((plate[0]<<16)|(plate[1]<<8)|plate[2])},
      ],
    },
  };
  return isReferenceLayout(layout) ? layout : undefined;
}

import type { ReferenceBox, ReferenceLayout, ReferenceTextBox } from "./reference-layout.ts";

import { photoCaptionLayout } from "./analyze-photo-caption.ts";

type InkLine = { left: number; right: number; top: number; bottom: number; ink: number; fill: number };
const hex = (rgb: number) => "#" + rgb.toString(16).padStart(6, "0");
const distance = (a: number, b: number) => Math.max(...[16,8,0].map(shift => Math.abs(((a >> shift) & 255) - ((b >> shift) & 255))));

// Look for short runs of contrasting ink on locally solid backgrounds. Text over photography
// is ambiguous: retain editable initial boxes when there is insufficient evidence.
export function analyzeReferenceImage(image: HTMLImageElement, initial: ReferenceLayout, brand?:string, mode:"automatic" | "edit-original"="edit-original"): ReferenceLayout {
  const fallback=()=>mode==="automatic" ? analyzeReferenceDesign(image,initial) : initial;
  if (!image.naturalWidth || !image.naturalHeight) return fallback();
  const scale = Math.min(1, 480 / Math.max(image.naturalWidth,image.naturalHeight));
  const canvas = document.createElement("canvas");
  const w = canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
  const h = canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx = canvas.getContext("2d",{willReadFrequently:true});
  if (!ctx || w<60 || h<60) return fallback();
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,w,h);
  ctx.drawImage(image,0,0,w,h);
  let pixels: Uint8ClampedArray;
  try { pixels = ctx.getImageData(0,0,w,h).data; } catch { return fallback(); }
  const caption = photoCaptionLayout(pixels,w,h,initial,brand);
  if (caption) return caption;
  if (mode==="automatic") return fallback();
  const rgb = (x:number,y:number) => {
    const i=(y*w+x)*4;
    return (pixels[i]<<16) | (pixels[i+1]<<8) | pixels[i+2];
  };
  function dominant(colors: number[]) {
    const bins = new Map<number,{count:number;sample:number}>();
    let top = {count:0,sample:0};
    for (const color of colors) {
      const key = color & 0xe0e0e0;
      const bin = bins.get(key) ?? {count:0,sample:color};
      ++bin.count; bins.set(key,bin);
      if (bin.count>top.count) top=bin;
    }
    return top;
  }
  const lines: InkLine[] = [];
  const tile = Math.max(16,Math.round(w/14));
  let active: InkLine | undefined;
  for (let y=1; y<h-1; y++) {
    let left=w, right=0, changes=0;
    const inks:number[] = [], fills:number[] = [];
    for (let x=0; x<w; x+=tile) {
      const colors=Array.from({length:Math.min(tile,w-x)},(_,i)=>rgb(x+i,y));
      const background=dominant(colors);
      if (background.count<colors.length*.48) continue;
      const strokes:number[]=[];
      let transitions=0, prior=false;
      colors.forEach((color,i)=>{
        const ink=distance(color,background.sample)>76;
        if(ink!==prior) transitions++;
        if(ink) strokes.push(i);
        prior=ink;
      });
      if(transitions<3 || !strokes.length || strokes.length>colors.length*.54) continue;
      changes+=transitions; left=Math.min(left,x+strokes[0]); right=Math.max(right,x+strokes[strokes.length-1]);
      for(const pos of strokes) inks.push(colors[pos]);
      fills.push(background.sample);
    }
    if(changes<8 || right-left<w*.065) continue;
    const fill=dominant(fills).sample;
    if(active && y-active.bottom<=2 && distance(active.fill,fill)<64 && left<=active.right+tile && right>=active.left-tile) {
      active.left=Math.min(active.left,left); active.right=Math.max(active.right,right); active.bottom=y;
    } else {
      active={left,right,top:y,bottom:y,ink:dominant(inks).sample,fill};lines.push(active);
    }
  }
  const height = (line: InkLine) => line.bottom-line.top+1;
  const text: InkLine[] = [];
  for (const line of lines.filter(line=>height(line)>=3 && height(line)<h*.14 && line.right-line.left>=height(line)*2)) {
    const prev=text.at(-1);
    const overlap=prev && Math.min(prev.right,line.right)-Math.max(prev.left,line.left);
    if(prev && overlap && overlap>.75*Math.min(prev.right-prev.left,line.right-line.left) &&
       line.top-prev.bottom<=Math.round(h*.023) && line.bottom-prev.top<h*.13) {
      prev.bottom=line.bottom; prev.left=Math.min(prev.left,line.left); prev.right=Math.max(prev.right,line.right);
    } else text.push({...line});
  }
  const headline = text.filter(line=>line.top<h*.75).sort((a,b)=>height(b)-height(a) || a.top-b.top)[0];
  if (!headline) return initial;
  const cta = text.filter(line=>line.top>Math.max(h*.62,headline.bottom+2)).at(-1);
  const body = text.filter(line=>line.top>headline.bottom+2 && line!==cta && line.bottom<(cta?.top??h))
    .sort((a,b)=>b.right-b.left-(a.right-a.left))[0];
  const pct = (n:number) => Math.round(n*100)/100;
  function box(line: InkLine, style: ReferenceTextBox) {
    const edge:number[]=[], content:number[]=[];
    for (let x=line.left;x<=line.right;x+=2) {
      edge.push(rgb(x,Math.max(0,line.top-2)),rgb(x,Math.min(h-1,line.bottom+2)));
    }
    const fill=dominant(edge).sample;
    for(let y=line.top;y<=line.bottom;y+=2) for(let x=line.left;x<=line.right;x+=2) {
      const pixel=rgb(x,y);
      if(distance(pixel,fill)>130) content.push(pixel);
    }
    const ink=content.length ? dominant(content).sample : line.ink;
    const pad=Math.max(3,Math.ceil(height(line)*.25));
    const left=Math.max(0,line.left-pad),right=Math.min(w,line.right+pad+1);
    const top=Math.max(0,line.top-pad),bottom=Math.min(h,line.bottom+pad+1);
    const bounds:ReferenceBox={x:pct(left/w*100),y:pct(top/h*100),w:pct(right/w*100)-pct(left/w*100),h:pct(bottom/h*100)-pct(top/h*100)};
    return {...style,...bounds,fill:hex(fill),color:hex(ink),
      align:Math.abs(left-(w-right))<w*.09?"center" as const:style.align,
      fontSize:Math.min(200,Math.max(12,Math.round(height(line)/w*1080*1.12)))};
  }
  const layout={...initial,headline:box(headline,initial.headline)};
  if (body && initial.body) layout.body=box(body,initial.body);
  if (cta) layout.cta=box(cta,initial.cta);
  // A run of textured rows between two text panels often marks the photo's actual edges.
  if(initial.photo) {
    const photoEnd = [body?.top,cta?.top,h].find(y=>y!==undefined && y>headline.bottom) ?? h;
    let start=-1, end=-1, lastDense=-1, bestStart=-1, bestEnd=-1;
    for(let y=headline.bottom+1;y<photoEnd;y++) {
      let busy=0;
      for(let x=0;x<w;x+=tile) {
        const strip=Array.from({length:Math.min(tile,w-x)},(_,i)=>rgb(x+i,y));
        if(dominant(strip).count<strip.length*.65) busy++;
      }
      if(busy>=Math.ceil(w/tile)*.22) {
        if(start===-1 || y-lastDense>tile*.5) start=y;
        lastDense=y; end=y;
        if(end-start>bestEnd-bestStart) {bestStart=start;bestEnd=end;}
      }
    }
    if(bestEnd-bestStart>h*.18) {
      const xs:number[]=[];
      for(let x=0;x<w;x++) {
        const column:number[]=[];
        for(let y=bestStart;y<=bestEnd;y+=3) column.push(rgb(x,y));
        if(dominant(column).count<column.length*.65) xs.push(x);
      }
      if(xs.length>w*.25) {
        const x=pct(xs[0]/w*100),y=pct(bestStart/h*100);
        layout.photo={x,y,w:pct((xs[xs.length-1]+1)/w*100)-x,h:pct((bestEnd+1)/h*100)-y};
      }
    }
  }
  return layout;
}

// Read layout at thumbnail scale. Large areas of identical paint distinguish a designed text
// panel from a photograph, even when both have the same average brightness.
export function analyzeReferenceDesign(image: HTMLImageElement, initial: ReferenceLayout): ReferenceLayout {
  const n = 64;
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("레퍼런스 이미지를 다시 열어 주세요.");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("레퍼런스의 디자인을 읽지 못했어요. 이미지를 다시 선택해 주세요.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, n, n);
  ctx.drawImage(image, 0, 0, n, n);
  const data = ctx.getImageData(0, 0, n, n).data;
  const colors = Array.from({length:n*n}, (_, i) => data[i*4]<<16 | data[i*4+1]<<8 | data[i*4+2]);
  function sample(region: (x:number, y:number) => boolean, mask = 0xf8f8f8) {
    const bins = new Map<number, { color:number; count:number }>();
    let total = 0;
    for (let i=0; i<colors.length; i++) {
      if (!region(i%n, Math.floor(i/n))) continue;
      const color = colors[i], key = color & mask;
      const bin = bins.get(key) ?? { color, count:0 };
      bin.count++; bins.set(key, bin); total++;
    }
    const palette = [...bins.values()].sort((a,b) => b.count-a.count);
    return { color:palette[0].color, flat:palette[0].count/total, palette };
  }
  const left = sample(x=>x<28), right = sample(x=>x>35);
  const top = sample((_,y)=>y<28), bottom = sample((_,y)=>y>35);
  const edge = sample((x,y)=>x<3 || x>60 || y<3 || y>60);
  const across = Math.abs(left.flat-right.flat), down = Math.abs(top.flat-bottom.flat);
  const twoPanels = Math.min(left.flat,right.flat)>.45 && distance(left.color,right.color)>86;
  const split = across>down && across>.28 && Math.max(left.flat,right.flat)>.42;
  const style = split || twoPanels ? "split" : edge.flat>.32 || Math.max(top.flat,bottom.flat)>.45 ? "stack" : "overlay";
  // imageSide describes the visual area: left/right in split, top/bottom in stack or overlay.
  const [start, end] = style === "split" ? [left,right] : [top,bottom];
  const imageSide = start.flat < end.flat ? "start" : "end";
  const paper = imageSide === "start" ? end : start;
  const palette = sample(()=>true, 0xe0e0e0).palette;
  const background = style === "stack" && edge.flat > .32 ? edge.color : paper.color;
  const channels = (rgb:number) => [(rgb>>16)&255, (rgb>>8)&255, rgb&255];
  function light(rgb:number) {
    const [r,g,b] = channels(rgb).map(value=> {
      const s = value/255;
      return s<=.04045 ? s/12.92 : ((s+.055)/1.055)**2.4;
    });
    return r*.2126 + g*.7152 + b*.0722;
  }
  const brightness = light(background);
  const contrast = (rgb:number) => (Math.max(light(rgb),brightness)+.05)/(Math.min(light(rgb),brightness)+.05);
  const ink = palette.find(({color})=>contrast(color)>=7)?.color ?? (brightness>.179 ? 0x111111 : 0xffffff);
  const accent = palette.find(({color,count}) => {
    const rgb = channels(color);
    return count>=colors.length*.004 && Math.max(...rgb)-Math.min(...rgb)>60 && distance(color,background)>72;
  })?.color ?? ink;
  let inkX = 0, marks = 0, heavyRows = 0;
  const paperCoverage = Array<number>(n).fill(0);
  let bandRows = 0, topWidth = 0, widest = 0, bandX = 0;
  let buttonStyle: NonNullable<ReferenceLayout["composition"]>["buttonStyle"] = "text";
  function endBand() {
    if (bandRows>=2 && bandRows<=10 && widest>=bandRows*2.5) {
      buttonStyle = widest-topWidth>2 ? "solid" : "square";
    }
    bandRows = 0;
  }
  for (let y=0; y<n; y++) {
    let runs = 0, rowMarks = 0, first = n, last = 0, priorMark = false;
    let bandMarks = 0, bandLeft = n, bandRight = 0;
    for (let x=0; x<n; x++) {
      const color = colors[y*n+x];
      const axis = style === "split" ? x : y;
      if (distance(color,paper.color)<=28) paperCoverage[imageSide==="start" ? axis : n-1-axis]+=1/n;
      const inPanel = imageSide === "start" ? axis>=36 : axis<28;
      const marked = inPanel && distance(color,paper.color)>108;
      if (marked) {
        if (!priorMark) runs++;
        rowMarks++; first=Math.min(first,x); last=x;
        marks++; inkX+=x;
      }
      priorMark=marked;
      if (distance(color,accent)<44) { bandMarks++; bandLeft=Math.min(bandLeft,x); bandRight=x; }
    }
    if (runs>=3 && last-first>=9 && rowMarks/(last-first+1)>.56) heavyRows++;
    const span = bandRight-bandLeft+1;
    const center = (bandRight+bandLeft)/2;
    // Text punched into a colored label can interrupt the middle rows of the same flat band.
    const flatBand = bandLeft>0 && bandRight<n-1 && span>=10 && span<=54 &&
      bandMarks/span>(bandRows && Math.abs(widest-span)<5 ? .18 : .70);
    if (!flatBand || Math.abs(center-bandX)>4) endBand();
    if (flatBand) {
      if (!bandRows) { topWidth=span; widest=span; }
      bandRows++; bandX=center; widest=Math.max(widest,span);
    }
  }
  endBand();
  const align = style !== "split" && marks>12 && Math.abs(inkX/marks-(n-1)/2)<n*.08 ? "center" : initial.headline.align;
  // Suggested treatments, not font recognition: sparse marks in photography give no weight
  // evidence. A flat field with repeated dense ink supports a heavy title. Both are editable.
  const headlineWeight = paper.flat>.38 && heavyRows>=2 ? 900 : 600;
  // Find the edge where mostly unpainted paper replaces the image. Require it to explain
  // the row/column pattern; a gradient, scattered text, or a photograph need no inferred ratio.
  let imageShare: number | undefined;
  if (style!=="overlay") {
    const total = paperCoverage.reduce((sum,value)=>sum+value,0);
    const variation = paperCoverage.reduce((sum,value)=>sum+(value-total/n)**2,0);
    let sum=0, best=0, edge=0;
    for (let cut=1; cut<n; cut++) {
      sum+=paperCoverage[cut-1];
      const change=(total-sum)/(n-cut)-sum/cut;
      const explained=change**2 * cut*(n-cut)/n;
      if (change>.22 && explained>best) { best=explained; edge=cut; }
    }
    const share=Math.round(edge/n*100)/100;
    if (best>variation*.55 && share>=.32 && share<=.65) imageShare=share;
  }
  return { ...initial, headline:{...initial.headline,align},
    composition:{style, background:hex(background), ink:hex(ink), accent:hex(accent), imageSide,
      fit:style === "stack" && edge.flat>.32 ? "contain" : "cover", headlineWeight,
      buttonStyle:style === "overlay" && paper.flat<.32 ? "text" : buttonStyle,
      ...(imageShare !== undefined && {imageShare})} };
}

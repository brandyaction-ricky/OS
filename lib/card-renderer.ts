export const CARD_SIZE = { width: 1080, height: 1350 };
/** Text-only canvas template. No remote fonts, images, HTML or executable markup. */
export async function renderContentCard(title: string, body: string, index: number, total: number) {
  await document.fonts.load('700 64px Pretendard');
  const canvas=document.createElement("canvas");canvas.width=CARD_SIZE.width;canvas.height=CARD_SIZE.height;
  const context=canvas.getContext("2d");if(!context)throw new Error("이미지 편집기를 열지 못했습니다.");
  const tokens=getComputedStyle(document.documentElement), color=(key:string)=>tokens.getPropertyValue(key).trim();
  context.fillStyle=color("--card");context.fillRect(0,0,1080,1350);
  context.fillStyle=color("--accent-2");context.fillRect(72,84,96,8);
  context.font='600 28px Pretendard, sans-serif';context.fillText("BRANDYACTION",72,150);
  const wrap=(value:string,font:string,lineHeight:number,y:number,maxLines:number)=>{
    context.font=font;context.fillStyle=color("--text");let line="",lines=0;
    for(const character of Array.from(value)){
      if(character==="\n"||context.measureText(line+character).width>920){context.fillText(line,72,y);y+=lineHeight;lines++;line="";if(lines>=maxLines)throw new Error("한 카드에 글이 너무 많습니다. 카드를 나눠 주세요.");if(character==="\n")continue;}
      line+=character;
    }
    if(line)context.fillText(line,72,y);
    return y+lineHeight;
  };
  const next=wrap(title,'700 64px Pretendard, sans-serif',88,280,4);
  wrap(body,'400 42px Pretendard, sans-serif',65,next+55,Math.floor((1190-next-55)/65));
  context.fillStyle=color("--muted");context.font='400 28px Pretendard, sans-serif';context.fillText(`${index+1} / ${total}`,72,1270);
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("카드 이미지를 만들지 못했습니다.")),"image/png"));
}

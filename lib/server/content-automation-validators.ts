import { ApiError } from "@/lib/http";

const ownPath=(path:unknown,ownerId:string,kind:string)=>
  typeof path==="string"&&new RegExp("^automation/"+ownerId+"/" +kind+"/[0-9a-f-]{36}\\.(png|jpg|webp|mp4)$").test(path);

export function validatePersonalAsset(metadata:Record<string,unknown>,ownerId:string){
  if(!ownPath(metadata.storagePath,ownerId,"asset"))
    throw new ApiError(422,"ASSET_FILE_REQUIRED","내 이미지 파일을 먼저 올려 주세요.");
  if(!["photo","logo","icon","frame","other"].includes(String(metadata.category))
    ||typeof metadata.alt!=="string"||!metadata.alt.trim()||metadata.alt.length>500
    ||!Number.isInteger(metadata.width)||Number(metadata.width)<1||Number(metadata.width)>20000
    ||!Number.isInteger(metadata.height)||Number(metadata.height)<1||Number(metadata.height)>20000)
    throw new ApiError(422,"ASSET_DETAILS_REQUIRED","이미지 분류·대체 텍스트·크기를 확인해 주세요.");
  const license=metadata.license as Record<string,unknown>|undefined;
  if(!license||!["own","designer","stock","unknown"].includes(String(license.source)))
    throw new ApiError(422,"ASSET_LICENSE_REQUIRED","이미지 출처를 기록해 주세요.");
  if(license.source==="stock"&&(!license.licenseNo||!String(license.licenseNo).trim()
    ||!String(license.vendor??"").trim()||typeof license.purchasedAt!=="string"
    ||!/^\d{4}-\d{2}-\d{2}$/.test(license.purchasedAt)
    ||Number.isNaN(Date.parse(license.purchasedAt))))
    throw new ApiError(422,"ASSET_LICENSE_REQUIRED","스톡 이미지의 라이선스 번호·구매처·구매일을 기록해 주세요.");
  const consent=metadata.consent as Record<string,unknown>|undefined;
  if(consent?.person===true&&(!consent.expiresAt||Number.isNaN(Date.parse(String(consent.expiresAt)))
    ||String(consent.expiresAt)<new Date().toISOString().slice(0,10)))
    throw new ApiError(422,"ASSET_CONSENT_REQUIRED","인물 이미지의 동의 만료일을 기록해 주세요.");
}

export function validatePersonalTemplate(metadata:Record<string,unknown>,ownerId:string){
  const pages=metadata.pages;
  if(!Array.isArray(pages)||!pages.length||pages.length>30)
    throw new ApiError(422,"TEMPLATE_PAGES_REQUIRED","템플릿 페이지를 확인해 주세요.");
  for(const page of pages){
    if(!page||typeof page!=="object"||!ownPath(page.bgPath,ownerId,"template"))
      throw new ApiError(422,"TEMPLATE_FILE_REQUIRED","내 템플릿 배경 파일을 먼저 올려 주세요.");
    const slots=page.slots;
    if(!Array.isArray(slots)||slots.length>60)
      throw new ApiError(422,"TEMPLATE_SLOTS_INVALID","템플릿 칸을 확인해 주세요.");
    const names=new Set<string>();
    for(const slot of slots){
      if(!slot||typeof slot!=="object"||typeof slot.name!=="string"||!slot.name.trim()
        ||names.has(slot.name)||!["text","image"].includes(String(slot.type)))
        throw new ApiError(422,"TEMPLATE_SLOT_NAME","같은 페이지의 칸 이름은 서로 달라야 합니다.");
      names.add(slot.name);
      for(const key of ["x","y","w","h"]){
        if(typeof slot[key]!=="number"||slot[key]<0||slot[key]>100)
          throw new ApiError(422,"TEMPLATE_SLOT_GEOMETRY","칸의 위치와 크기를 확인해 주세요.");
      }
      if(slot.x+slot.w>100||slot.y+slot.h>100||slot.w===0||slot.h===0)
        throw new ApiError(422,"TEMPLATE_SLOT_GEOMETRY","칸이 페이지 밖으로 나가지 않게 해 주세요.");
      if(slot.type==="text"&&(!/^#[0-9a-fA-F]{6}$/.test(String(slot.color))
        ||!Number.isInteger(slot.size)||slot.size<11||slot.size>160
        ||!Number.isInteger(slot.lines)||slot.lines<1||slot.lines>30))
        throw new ApiError(422,"TEMPLATE_SLOT_STYLE","글 칸의 색·크기·줄 수를 확인해 주세요.");
    }
  }
}

export function validatePersonalItem(metadata:Record<string,unknown>,channel:string,ownerId:string){
  if(metadata.channel!==channel)throw new ApiError(422,"CHANNEL_IMMUTABLE","채널을 바꿀 수 없습니다.");
  if(channel==="threads"){
    if(!Array.isArray(metadata.posts)||metadata.posts.some(value=>typeof value!=="string"||Array.from(value).length>500))
      throw new ApiError(422,"THREADS_LENGTH","쓰레드 글마다 500자 이내로 입력해 주세요.");
  }
  if(channel==="card"&&metadata.pages!==undefined&&(!Array.isArray(metadata.pages)||metadata.pages.length>30))
    throw new ApiError(422,"CARD_PAGES_INVALID","카드뉴스 페이지를 확인해 주세요.");
  if(channel==="shorts"&&metadata.cuts!==undefined&&(!Array.isArray(metadata.cuts)||metadata.cuts.length>100))
    throw new ApiError(422,"SHORTS_CUTS_INVALID","쇼츠 컷 구성을 확인해 주세요.");
  if(channel==="shorts"&&metadata.mp4Path&&!ownPath(metadata.mp4Path,ownerId,"shorts"))
    throw new ApiError(422,"SHORTS_FILE_INVALID","내 작업 공간에 올린 MP4 파일을 선택해 주세요.");
  if(channel==="shorts"&&metadata.coverPath&&!ownPath(metadata.coverPath,ownerId,"asset"))
    throw new ApiError(422,"SHORTS_COVER_INVALID","내 이미지에서 커버를 선택해 주세요.");
}

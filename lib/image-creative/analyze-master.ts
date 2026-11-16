import { analyzeReferenceImage } from "./analyze-reference.ts";
import knownRecipes from "./reference-masters.json" with { type: "json" };
import { isReferenceLayout, type ReferenceLayout } from "./reference-layout.ts";

const recipeFormat = "os-reference-master/1";
const sizeLimit = 32 * 1024;

async function sourceHash(image: HTMLImageElement) {
  const response = await fetch(image.currentSrc || image.src, {credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error("레퍼런스 원본을 읽지 못했어요.");
  const blob = await response.blob();
  if (blob.size > 5*1024*1024) throw new Error("5MB 이하 원본을 선택해 주세요.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}

export async function prepareMasterLayout(image:HTMLImageElement, initial:ReferenceLayout, brand?:string, mode:"automatic" | "edit-original"="automatic"):Promise<ReferenceLayout> {
  const candidates = knownRecipes.filter(recipe => recipe.width === image.naturalWidth && recipe.height === image.naturalHeight);
  if (candidates.length) {
    const digest = await sourceHash(image);
    const recipe = candidates.find(entry => entry.sha256 === digest);
    if (recipe) {
      const layout = {source:initial.source,...recipe.template};
      if (!isReferenceLayout(layout)) throw new Error("등록한 원본의 교체 위치를 확인해 주세요.");
      return layout;
    }
  }
  const layout = analyzeReferenceImage(image,initial,brand,mode);
  if (layout.master || layout.composition) return layout;
  return {...layout,master:{v:1,background:layout.headline.fill==="transparent" ? "#ffffff" : layout.headline.fill,regions:[],headlineWeight:600}};
}

export async function exportMasterRecipe(image:HTMLImageElement, layout:ReferenceLayout):Promise<string> {
  if(!isReferenceLayout(layout) || !layout.master) throw new Error("원본 디자인의 교체 영역을 먼저 확인해 주세요.");
  const {source,...template} = layout;
  return JSON.stringify({format:recipeFormat,sha256:await sourceHash(image),width:source.w,height:source.h,template},null,2);
}

export async function applyMasterRecipe(image:HTMLImageElement,current:ReferenceLayout,json:string):Promise<ReferenceLayout> {
  if(json.length>sizeLimit) throw new Error("교체 위치 파일은 32KB 이하여야 해요.");
  let data;
  try { data=JSON.parse(json); }
  catch { throw new Error("교체 위치 파일의 JSON을 읽을 수 없어요."); }
  if(!data || data.format!==recipeFormat || data.width!==current.source.w || data.height!==current.source.h ||
      typeof data.sha256!=="string" || !/^[a-f0-9]{64}$/.test(data.sha256) || !data.template || typeof data.template!=="object" ||
      Object.hasOwn(data.template,"source") || !data.template.master)
    throw new Error("이 이미지에서 사용할 수 있는 교체 위치 파일을 선택해 주세요.");
  const layout={...data.template,source:current.source};
  if(!isReferenceLayout(layout) || layout.composition) throw new Error("교체 위치와 서식을 확인해 주세요.");
  if(await sourceHash(image)!==data.sha256) throw new Error("저장할 때 사용한 원본 이미지와 달라요.");
  return layout;
}

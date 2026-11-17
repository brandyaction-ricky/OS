import { validWarehouseBrand, sameImageBrief, type ImageBrief } from "./model.ts";
import { markdownBlocks, markdownSections, type MarkdownSection } from "../markdown-sections.ts";

export interface ImageAdProductSource { id: string; title: string; version: number }
export interface ImageAdProduct {
  id: string; product: string; brand: string; audience: string; offer: string;
  objective?: string; funnel?: string;
  needsData?: string;
  source: ImageAdProductSource; audienceSource?: ImageAdProductSource;
}
export interface ImageProductDocument {
  id: string; title: string; current_version: number; status: string; content_md: string;
}

// Goal and funnel can be adjusted for an individual ad. The remaining facts belong to the selected canon.
export function imageBriefMatchesProduct(brief:ImageBrief, row:ImageAdProduct|undefined) {
  const ref = brief.productSource;
  return !ref || Boolean(row && !row.needsData && ref.productId === row.id && ref.source.id === row.source.id &&
    ref.source.version === row.source.version && ref.audienceSource?.id === row.audienceSource?.id &&
    ref.audienceSource?.version === row.audienceSource?.version && brief.product === row.product &&
    brief.audience === row.audience && brief.offer === row.offer && (brief.brand ?? "") === (row.brand ?? ""));
}

export function onlyImageProductVersionChanged(previous:ImageBrief, next:ImageBrief) {
  const old = previous.productSource, current = next.productSource;
  return Boolean(old && current && old.productId===current.productId && old.source.id===current.source.id &&
    old.audienceSource?.id===current.audienceSource?.id &&
    (old.source.version!==current.source.version || old.audienceSource?.version!==current.audienceSource?.version) &&
    sameImageBrief({...previous,productSource:current},next));
}

export function briefForImageProduct(brief:ImageBrief, row:ImageAdProduct):ImageBrief {
  const sameProduct = brief.productSource?.productId===row.id;
  return {...brief,product:row.product,brand:row.brand,audience:row.audience,offer:row.offer,
    objective:sameProduct ? brief.objective : row.objective ?? "",funnel:sameProduct ? brief.funnel : row.funnel ?? "",
    productSource:{productId:row.id,source:{id:row.source.id,version:row.source.version},...(row.audienceSource &&
      {audienceSource:{id:row.audienceSource.id,version:row.audienceSource.version}})}};
}

const channelTitle = "마이인 유입용 직원 자동화 채널 — 운영 정본";
const audienceTitle = "BRANDYACTION 핵심 컨텍스트";
const listTitle = "이미지 광고 상품 목록";
export const IMAGE_PRODUCT_CANON_TITLES = [channelTitle, audienceTitle, listTitle];
// Explicitly approved operating titles may be team-shared. This is not a blanket promotion of team documents to canon.
export const IMAGE_PRODUCT_OPERATING_SOURCES = {
  core: {title:"마이인 맞춤형 핵심 보고서 — 현재 운영 기준 (상품·맞춤 장·동선·환불)"},
  precision: {title:"마이인 맞춤형 정밀 보고서 — 현재 운영 기준 (구성·생성·검사)"},
  strength: {title:"강점 해설집 — 상품 기획·제작 기준"},
} as const;
export const IMAGE_PRODUCT_OPERATING_TITLES = Object.values(IMAGE_PRODUCT_OPERATING_SOURCES).map(row=>row.title);

/** Missing source content remains visible as a choice, never as a usable offer or a successful canon read. */
export function withImageProductChoices(products:ImageAdProduct[]):ImageAdProduct[] {
  const choices = [
    {id:"myin-free",product:"무료 진단",source:{title:channelTitle}},
    {id:"myin-core",product:"맞춤형 핵심 보고서",source:IMAGE_PRODUCT_OPERATING_SOURCES.core},
    {id:"myin-precision",product:"맞춤형 정밀 보고서",source:IMAGE_PRODUCT_OPERATING_SOURCES.precision},
    {id:"myin-strength",product:"강점 공략집",source:IMAGE_PRODUCT_OPERATING_SOURCES.strength},
  ];
  return [...choices.map(choice=>products.find(row=>row.id===choice.id) ?? {...choice,brand:"마이인",audience:"",offer:"",
    source:{...choice.source,id:"",version:0},needsData:"이 상품의 현재 제공 내용을 확인하지 못했어요. 연결된 문서를 확인한 뒤 사용할 수 있어요."}),
    ...products.filter(row=>!choices.some(choice=>choice.id===row.id))];
}
const source = (doc: ImageProductDocument) => ({id:doc.id, title:doc.title, version:doc.current_version});
const unique = <T,>(rows: T[]) => rows.length === 1 ? rows[0] : undefined;

function sections(root: MarkdownSection): MarkdownSection[] {
  return [root, ...root.children.flatMap(sections)];
}

// A table in a fenced example or a different section is not product data.
function table(root: MarkdownSection, heading: RegExp, firstColumn: string) {
  const section = unique(sections(root).filter(row => heading.test(row.title)));
  if (!section) return [];
  const blocks = markdownBlocks(section.body).filter(block=>block.trimStart().startsWith("|"));
  const split = (line: string) => line.trim().slice(1,-1).split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,"|").replace(/\*\*/g,""));
  const matches = blocks.map(block=>block.split("\n").filter(line=>/^\s*\|.*\|\s*$/.test(line)).map(split))
    .filter(lines=>lines[0]?.[0]===firstColumn && lines[1]?.length===lines[0].length && lines[1].every(cell=>/^:?-{3,}:?$/.test(cell)));
  const match = unique(matches);
  if (!match || new Set(match[0]).size !== match[0].length) return [];
  return match.slice(2).filter(row=>row.length===match[0].length).map(row=>Object.fromEntries(match[0].map((key,i)=>[key,row[i]])));
}
function value(rows: Record<string,string>[], key: string, label: string, column: string) {
  return unique(rows.filter(row=>row[key]===label))?.[column]?.trim();
}

export function imageAdProductsFromCanon(documents: ImageProductDocument[]): ImageAdProduct[] {
  const canon = (title: string) => unique(documents.filter(doc=>doc.title===title && doc.status==="canonical" && doc.current_version > 0));
  const registry = canon(listTitle);
  const products: ImageAdProduct[] = [];
  if (registry) {
    const rows = table(markdownSections(registry.content_md), /^상품 목록$/, "상품 ID");
    for (const row of rows) {
      if (!/^[a-zA-Z0-9_-]{1,48}$/.test(row["상품 ID"] ?? "") || !unique(rows.filter(item=>item["상품 ID"]===row["상품 ID"]))) continue;
      if (!validWarehouseBrand(row["브랜드"]) || !["상품","타겟","제공 내용"].every(k=>row[k]) || ["상품","타겟","제공 내용","소재 목표","퍼널"].some(k=>(row[k]?.length ?? 0) > 2000)) continue;
      products.push({id:"catalog-"+row["상품 ID"], product:row["상품"], brand:row["브랜드"], audience:row["타겟"], offer:row["제공 내용"],
        ...(row["소재 목표"] ? {objective:row["소재 목표"]} : {}), ...(row["퍼널"] ? {funnel:row["퍼널"]} : {}), source:source(registry)});
    }
  }

  const channel = canon(channelTitle), target = canon(audienceTitle);
  if (!target) return products;
  const targetRoot = unique(sections(markdownSections(target.content_md)).filter(s=>s.title.startsWith("마이인 핵심 타겟·포지셔닝·메시지")));
  const audience = targetRoot && value(table(targetRoot,/^타겟 우선순위$/,"구분"),"구분","주력 타겟","대상");
  if (!audience || audience.length > 2000) return products;
  const operating = (key:keyof typeof IMAGE_PRODUCT_OPERATING_SOURCES) => {
    const expected = IMAGE_PRODUCT_OPERATING_SOURCES[key];
    return unique(documents.filter(doc=>doc.title===expected.title && ["canonical","team"].includes(doc.status) && doc.current_version>0));
  };
  for (const key of ["core","precision"] as const) {
    const doc = operating(key);
    if (!doc) continue;
    const rows = table(markdownSections(doc.content_md), /^0\. 한눈에 보기$/, "항목");
    const product = value(rows,"항목","이름","지금 운영 코드의 사실")?.match(/「([^」]+)」/)?.[1];
    const labels = key === "core" ? ["고객에게 여는 것","잠그는 것","보는 방식"] : ["분량","장 순서","보는 방식","함께 주는 것"];
    const parts = labels.map(label=>value(rows,"항목",label,"지금 운영 코드의 사실"));
    if (!product || parts.some(part=>!part)) continue;
    const offer = parts.join(" · ");
    if (product.length>2000 || offer.length>2000) continue;
    products.push({id:"myin-"+key,product,brand:"마이인",audience,offer,objective:product+" 확인",source:source(doc),audienceSource:source(target)});
  }
  // 강점 공략집: the customer name, the page count and the page list of the 현행 판 section. Its price table is a September record, so no price.
  const guide = operating("strength");
  if (guide) {
    const name = guide.content_md.match(/고객에게 보이는 상품 명칭은 \*\*‘([^’\n]+)’\*\*/)?.[1];
    const current = unique(sections(markdownSections(guide.content_md)).filter(s=>/^현행 판 v[\d.]+/.test(s.title)));
    const pages = current?.body.match(/PDF 한 권은 (\d+)쪽/)?.[1];
    const parts = current ? table(current, /^현행 판 v[\d.]+/, "쪽").filter(row=>/^\d/.test(row["쪽"])).map(row=>row["이름"]).filter(Boolean) : [];
    const offer = `강점 한 개를 깊게 읽는 해설 · 한 권 ${pages}쪽, 웹에서 읽고 PDF로 받기 · ${parts.join(" · ")}`;
    if (name && pages && parts.length && name.length <= 2000 && offer.length <= 2000)
      products.push({id:"myin-strength",product:name,brand:"마이인",audience,offer,objective:name+" 확인",source:source(guide),audienceSource:source(target)});
  }
  if (!channel) return products;
  const root = markdownSections(channel.content_md);
  const catalogSection = unique(sections(root).filter(s=>/^12\. myinlab 개발 상품 기준과 출시 준비/.test(s.title)));
  const catalog = catalogSection ? table(catalogSection,/^확인 범위와 적용$/,"구성") : [];
  const evidence = table(root,/^(?:\d+(?:\.\d+)*\.?\s+)?상품과 구매 설득의 실제 근거$/,"항목");
  const contract = table(root,/^(?:\d+(?:\.\d+)*\.?\s+)?무료·정밀 두 경로의 역할$/,"계약");
  const goals = table(root,/^(?:\d+(?:\.\d+)*\.?\s+)?화면별 설계와 구매 연결$/,"화면");
  for (const entry of [
    {id:"myin-free", product:"무료 진단", column:"F: 무료 경험 경로", page:"무료 소개"},
  ]) {
    if (products.some(product=>product.id===entry.id)) continue;
    const adminOffer = value(catalog,"구성",entry.product,"제공 내용·확인 범위");
    if (!adminOffer) continue;
    const sample = value(evidence,"항목","무료 결과","실제 확인");
    if (entry.id === "myin-free" && !sample) continue;
    const offer = entry.id === "myin-free" ? "공개 결과 견본 기준 · " + sample : adminOffer;
    if (offer.length > 2000 || products.some(p=>p.brand==="마이인" && p.product===entry.product)) continue;
    const objective = value(goals,"화면",entry.page,"주 행동");
    if (objective && objective.length > 2000) continue;
    const funnel = contract.some(row=>row["계약"]==="기본 동선" && row[entry.column]) ? entry.column.slice(3) : undefined;
    products.push({id:entry.id, brand:"마이인", product:entry.product, audience, offer, objective, funnel,
      source:source(channel), audienceSource:source(target)});
  }
  return products.sort((a,b)=>["myin-free","myin-core","myin-precision","myin-strength"].indexOf(a.id)-["myin-free","myin-core","myin-precision","myin-strength"].indexOf(b.id));
}

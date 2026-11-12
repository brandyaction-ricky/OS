import { validWarehouseBrand } from "./model.ts";
import { markdownBlocks, markdownSections, type MarkdownSection } from "../markdown-sections.ts";

export interface ImageAdProductSource { id: string; title: string; version: number }
export interface ImageAdProduct {
  id: string; product: string; brand: string; audience: string; offer: string;
  objective?: string; funnel?: string;
  source: ImageAdProductSource; audienceSource?: ImageAdProductSource;
}
export interface ImageProductDocument {
  id: string; title: string; current_version: number; status: string; content_md: string;
}

const channelTitle = "마이인 유입용 직원 자동화 채널 — 운영 정본";
const audienceTitle = "BRANDYACTION 핵심 컨텍스트";
const listTitle = "이미지 광고 상품 목록";
export const IMAGE_PRODUCT_CANON_TITLES = [channelTitle, audienceTitle, listTitle];
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
  if (!channel || !target) return products;
  const targetRoot = unique(sections(markdownSections(target.content_md)).filter(s=>s.title.startsWith("마이인 핵심 타겟·포지셔닝·메시지")));
  const audience = targetRoot && value(table(targetRoot,/^타겟 우선순위$/,"구분"),"구분","주력 타겟","대상");
  if (!audience || audience.length > 2000) return products;
  const root = markdownSections(channel.content_md);
  const catalogSection = unique(sections(root).filter(s=>/^12\. myinlab 개발 상품 기준과 출시 준비/.test(s.title)));
  const catalog = catalogSection ? table(catalogSection,/^확인 범위와 적용$/,"구성") : [];
  const evidence = table(root,/^(?:\d+(?:\.\d+)*\.?\s+)?상품과 구매 설득의 실제 근거$/,"항목");
  const contract = table(root,/^(?:\d+(?:\.\d+)*\.?\s+)?무료·정밀 두 경로의 역할$/,"계약");
  const goals = table(root,/^(?:\d+(?:\.\d+)*\.?\s+)?화면별 설계와 구매 연결$/,"화면");
  for (const entry of [
    {id:"myin-free", product:"무료 진단", column:"F: 무료 경험 경로", page:"무료 소개"},
    {id:"myin-precision", product:"업(業) 방향 진단 — 정밀", column:"P: 정밀 직접 경로", page:"정밀 소개"},
  ]) {
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
  return products;
}

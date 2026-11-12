// Rebuild the public, sample-only thumbnails when the image-ad compositions change.
// To render a single format: node tools/render-image-format-examples.mjs --format thumbnail_subject
// To export same-photo, same-copy PNGs and a comparison sheet: --compare /path/to/output
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { CREATIVE_SIZES, IMAGE_FORMATS, IMAGE_FORMAT_IDS, isWarehouseFormat } from "../lib/image-creative/formats.ts";
import { installedAdRuntime, renderAdPng } from "./image-ad-renderer.mjs";
import { MYIN_FORMAT_TEST } from "../lib/image-creative/format-test.ts";
import { imageVariantProblems } from "../lib/image-creative/model.ts";
import { photoSubjectBox } from "../lib/image-creative/subject-box.ts";


const require = createRequire(import.meta.url);
const sharp = require("next/dist/server/image-optimizer").getSharp();
const { ImageResponse } = require("next/og");
const { values } = parseArgs({ options: { format: {type:"string"}, compare: {type:"string"} } });
if (values.format && !IMAGE_FORMAT_IDS.includes(values.format)) throw new Error("알 수 없는 포맷입니다.");
const formats = values.format ? [values.format] : values.compare ? [] : IMAGE_FORMAT_IDS;
const runtime = installedAdRuntime(process.cwd());
const dir = "public/image-format-test/examples";
await mkdir(dir, { recursive: true });
const dataUrl = (type, bytes) => "data:" + type + ";base64," + bytes.toString("base64");
const photo = await readFile("public/image-format-test/master.jpg");
const subject = await readFile("public/image-format-test/thumbnail-subject.jpg");
const { width, height } = await sharp(photo).metadata();
const hand = await sharp(photo).extract({ left: Math.round(width * .30), top: Math.round(height * .55),
  width: Math.round(width * .65), height: Math.round(height * .43) }).jpeg().toBuffer();
const fonts = await Promise.all([400, 500, 600].map(async weight => ({
  name: "Pretendard", weight, style: "normal", data: await readFile("lib/cardnews/fonts/Pretendard-" + weight + ".woff"),
})));
const sampleReport = h("div", { style: { display:"flex", flexDirection:"column", width:"100%", height:"100%", background:"#FAF9F5", color:"#162D27", fontFamily:"Pretendard", padding:55 } },
  h("div", { style:{ fontSize:24, color:"#567766" } }, "결과 예시"),
  h("div", { style:{ fontSize:58, marginTop:20, fontWeight:600 } }, "나의 일 선택 기준"),
  h("div", { style:{ fontSize:28, marginTop:10 } }, "어떤 일을 할 때 몰입했나요?"),
  ...["복잡한 정보를 정리할 때", "동료에게 방법을 설명할 때"].map((label, i) => h("div", { key:label,
    style:{display:"flex", gap:20, background: i ? "#ECEFE9" : "#DBE9A5", padding:"17px 24px", fontSize:30, marginTop:18} }, String(i + 1).padStart(2,"0"), "   " + label)));
const report = Buffer.from(await new ImageResponse(sampleReport, {width:820,height:470,fonts}).arrayBuffer());
const copyExamples = {
  thumbnail_subject: ["연봉은 같은데,\n어디로 가지?", "내가 일에서 중요하게 여기는 조건을 확인해 보세요."],
  photo_headline: ["저장해 둔 공고만 늘었다", "어디에 지원할지 내 기준부터 찾아보세요."],
  split_compare: ["어떤 기준으로 일을 고르나요?", "남들이 좋다는 일\n내가 잘하는 일"],
  note: ["다음 지원 전에\n나에게 묻기", "시간 가는 줄 모르고 했던 일은 뭐였지?"],
  annotated: ["지원 버튼에서 멈췄다면", "손이 멈춘 순간, 어떤 조건이 걸렸나요?"],
  object_spotlight: ["누르기 직전, 왜 망설일까?", "내가 중요하게 여기는 조건을 확인해 보세요."],
  checklist: ["일 고를 때 챙기는 건?", "함께 일하는 사람\n내가 맡을 역할\n집중할 수 있는 환경"],
  question: ["나한테 맞는 일,\n어떻게 고르지?", "최근에 즐거웠던 일을 떠올려 보세요."],
  typography: ["공고보다 먼저,\n나의 기준", "내가 잘하는 일부터 찾아보세요."],
  steps: ["내 기준 찾는 순서", "일했던 장면 떠올리기\n내가 한 행동 고르기\n공통점 찾아보기"],
  conversation: ["다 괜찮아 보여.\n뭘 골라야 하지?", "네가 좋아했던 일은 어떤 일이었어?"],
  reframe: ["고민이 길어지는 이유", "결정을 못하는 걸까?\n내 기준이 없었던 걸까?"],
  report_crop: ["내가 몰입했던 일은?", "내 일을 고르는 기준을 한눈에 확인하세요."],
};

async function renderSample(formatId, size, bytes, copy) {
  const format = IMAGE_FORMATS[formatId];
  const variant = {
    formatId, formatVersion:format.version, size, copy,
    appeal:{id:"sample", meaning:"일을 고를 기준 찾기"},
    ...(isWarehouseFormat(formatId) ? {brand:MYIN_FORMAT_TEST.copy.brand} : {}),
  };
  let assetUrl;
  if (format.assetRequired) {
    const {width, height} = await sharp(bytes).metadata();
    variant.asset = {path:"demo/sample.png", w:width, h:height};
    if (formatId === "thumbnail_subject") {
      const pixels = await sharp(bytes).toColourspace("srgb").ensureAlpha().raw().toBuffer();
      const subjectBox = photoSubjectBox(pixels, width, height);
      if (subjectBox) variant.asset.subjectBox = subjectBox;
    }
    assetUrl = dataUrl("image/png", await sharp(bytes).png().toBuffer());
  }
  const problems = imageVariantProblems(variant);
  if (problems.length) throw new Error(formatId + "/" + size + ": " + problems.join(" "));
  return renderAdPng(runtime, variant, assetUrl);
}

const defaultCta = MYIN_FORMAT_TEST.copy.cta;
const images = {thumbnail_subject: subject, report_crop: report, annotated: hand, object_spotlight: hand};
for (const id of formats) {
  const warehouse = isWarehouseFormat(id);
  const [headline, body] = warehouse ? [MYIN_FORMAT_TEST.copy.headline, MYIN_FORMAT_TEST.copy.support] : copyExamples[id];
  for (const size of warehouse ? ["portrait"] : Object.keys(CREATIVE_SIZES)) {
    const png = await renderSample(id, size, images[id] || photo, {headline, body, cta:defaultCta});
    await sharp(png).resize(540).webp({quality:85}).toFile(path.join(dir, id + "-" + size + ".webp"));
  }
}

if (values.compare) {
  await mkdir(values.compare, {recursive:true});
  const [headline, body] = copyExamples.thumbnail_subject;
  const labels = ["기존 · 사진 한 장", "신규 · 썸네일형"];
  const cardWidth = 390, cardHeight = Math.round(cardWidth * 5 / 4), gutter = 18;
  const boardWidth = cardWidth * 2 + gutter * 3, headerHeight = 54;
  const header = h("div", {style:{display:"flex", width:boardWidth, height:headerHeight, paddingLeft:gutter,
    background:"#E8E8E8", color:"#191919", fontFamily:"Pretendard", fontWeight:600, fontSize:20, alignItems:"center"}},
    ...labels.map(label => h("div", {key:label, style:{display:"flex", width:cardWidth+gutter}}, label)));
  const headerPng = Buffer.from(await new ImageResponse(header, {width:boardWidth, height:headerHeight, fonts}).arrayBuffer());
  const layers = [{input:headerPng, top:0, left:0}];
  for (const [index, id] of ["photo_headline", "thumbnail_subject"].entries()) {
    const png = await renderSample(id, "portrait", subject, {headline, body, cta:defaultCta});
    await writeFile(path.join(values.compare, id + ".png"), png);
    layers.push({input:await sharp(png).resize(cardWidth).png().toBuffer(), top:headerHeight, left:gutter + index * (cardWidth + gutter)});
  }
  await sharp({create:{width:boardWidth, height:headerHeight+cardHeight+gutter, channels:3, background:"#E8E8E8"}})
    .composite(layers).jpeg({quality:92}).toFile(path.join(values.compare, "비교.jpg"));
}

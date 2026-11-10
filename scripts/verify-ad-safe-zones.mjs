// Pixel regression: change only visible text, then locate every changed pixel on the final PNG.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { LEGACY_IMAGE_FORMAT_IDS, WAREHOUSE_FORMAT_IDS, IMAGE_FORMATS } from "../lib/image-creative/formats.ts";
import { PLACEMENT_IDS, resolvePlacement } from "../lib/image-creative/placement.ts";
import { renderFormatTestSvg } from "../lib/image-creative/format-test-renderer.mjs";

const require = createRequire(new URL("../lib/image-creative/view.tsx", import.meta.url));
const { chromium } = require("playwright");
const sharp = require("sharp");
const { ImageResponse } = require("next/og");
const source = await readFile(new URL("../lib/image-creative/view.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", code)(require, compiled, compiled.exports);
const read = p => readFile(new URL("../" + p, import.meta.url));
const baseFont = await read("public/fonts/pretendard/PretendardVariable.woff2");
const fontData = "data:font/woff2;base64," + baseFont.toString("base64");
const sourcePhoto = await read("public/image-format-test/master.jpg");
const photo = "data:image/jpeg;base64," + sourcePhoto.toString("base64");
const fonts = await Promise.all([400,500,600].map(async weight => ({
  name:"Pretendard", weight, style:"normal", data:await read("lib/cardnews/fonts/Pretendard-" + weight + ".woff"),
})));
const display = require("./format-test-fonts.json");
// An unpacked device runtime can be checked against the independently rendered OS preview.
const macRuntime = process.env.IMAGE_AD_VERIFY_RUNTIME;
const renderer = macRuntime && await import("../tools/image-ad-renderer.mjs");
let compared = 0;
const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
let verified = 0;
try {
  const page = await browser.newPage();
  const allIds = [...LEGACY_IMAGE_FORMAT_IDS, ...WAREHOUSE_FORMAT_IDS];
  for (const id of allIds) for (const pid of PLACEMENT_IDS) {
    const compareMac = Boolean(renderer) && PLACEMENT_IDS[allIds.indexOf(id) % PLACEMENT_IDS.length] === pid;
    const edited = compareMac && pid === "reel";
    const design = { placement: pid, font: edited ? "serif" : "original", card: edited ? "paper" : "original",
      ...(edited ? { outputWidth: 1440 } : {}) };
    const p = resolvePlacement("portrait", pid, design.outputWidth);
    const spec = IMAGE_FORMATS[id];
    const warehouse = WAREHOUSE_FORMAT_IDS.includes(id);
    const variantFor = phrase => ({
      id: "renderer-probe", formatId: id, formatVersion: warehouse ? 2 : 1, size: p.size, design,
      ...(warehouse ? { brand: phrase } : {}),
      appeal: { id: "probe", meaning: phrase },
      copy: { headline: phrase, body: Array(spec.bodyLines || 1).fill(phrase).join("\n"), cta: phrase },
      ...(spec.supportsAsset ? { asset: { path: "demo/probe.jpg", w: 1536, h: 1024 } } : {}),
    });
    async function output(phrase) {
      const variant = variantFor(phrase);
      if (warehouse) {
        const faceFile = edited ? "serif.woff2" : display[id];
        const face = faceFile && await read("public/image-format-test/fonts/" + faceFile);
        const svg = renderFormatTestSvg({ formatId:id, design, photo, fontData,
          copy:{brand:phrase,headline:phrase,support:phrase,cta:phrase},
          ...(face ? {displayFontData:"data:font/woff2;base64," + face.toString("base64")} : {}) });
        const b64 = await page.evaluate(async svg => {
          const url = URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"}));
          try {
            const img = new Image(); img.src=url; await img.decode();
            const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height=img.naturalHeight;
            c.getContext("2d", { willReadFrequently: true }).drawImage(img,0,0); return c.toDataURL("image/png").split(",")[1];
          } finally {URL.revokeObjectURL(url);}
        },svg);
        return Buffer.from(b64,"base64");
      }
      const selectedFonts = edited ? [...fonts, { name: "Ad-serif", weight: 600, style: "normal",
        data: await read("lib/image-creative/fonts/serif.woff") }] : fonts;
      const png = new ImageResponse(createElement(compiled.exports.ImageCreativeView,{variant,assetUrl:photo}),
        {width:p.width,height:p.height,fonts:selectedFonts});
      return Buffer.from(await png.arrayBuffer());
    }
    const [first,second] = await Promise.all(["첫번째","두번째"].map(async text =>
      sharp(await output(text)).removeAlpha().raw().toBuffer({resolveWithObject:true})));
    assert.deepEqual([first.info.width,first.info.height],[p.width,p.height],id+"/"+pid);
    assert.deepEqual(first.info,second.info);
    if (compareMac) {
      const variant = variantFor("첫번째");
      const png = await renderer.renderAdPng(macRuntime, variant, variant.asset ? photo : undefined, { chromePath: process.env.CHROME_PATH });
      const onMac = await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
      assert.deepEqual(onMac.info, first.info, id + " device dimensions differ");
      assert.ok(first.data.equals(onMac.data), id + "/" + pid + " device pixels differ from OS preview");
      compared++;
    }
    let changed = 0;
    const s=p.safe,n=first.info.channels;
    for(let offset=0;offset<first.data.length;offset+=n) {
      if(first.data[offset]===second.data[offset] && first.data[offset+1]===second.data[offset+1] && first.data[offset+2]===second.data[offset+2])continue;
      const px=offset/n, x=px%p.width, y=Math.floor(px/p.width);
      if(x<s.x || y<s.y || x>=s.x+s.width || y>=s.y+s.height)throw Error(id+"/"+pid+" changed text pixel outside safe region at "+x+","+y);
      changed++;
    }
    assert.ok(changed>50,id+"/"+pid+" has no visible text change");
    verified++;
  }
} finally {await browser.close();}
console.log(verified+" format and placement pairs: changed text pixels stay inside the final PNG safe region");
if (renderer) console.log(compared + " Mac PNGs match the OS preview pixel for pixel");

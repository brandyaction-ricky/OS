import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { ImageCreativeView } from "./helpers/image-view.mjs";
import { imageVariantProblems } from "../lib/image-creative/model.ts";
import { resolvePlacement } from "../lib/image-creative/placement.ts";
import { installedAdRuntime, renderAdPng } from "../tools/image-ad-renderer.mjs";

const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/og");
const sharp = require("next/dist/server/image-optimizer").getSharp();

test("thumbnail preview and Mac agree at every placement, including the last glyph of each approved field", async () => {
  const fonts = await Promise.all([400,500,600,900].map(async weight => ({
    name:"Pretendard", style:"normal", weight, data:await readFile(new URL(
      "../lib/cardnews/fonts/Pretendard-" + weight + (weight === 900 ? ".otf" : ".woff"), import.meta.url)),
  })));
  const photo = "data:image/jpeg;base64," + (await readFile(new URL("../public/image-format-test/thumbnail-subject.jpg", import.meta.url))).toString("base64");
  const copy = {headline:"꽉".repeat(24), body:"꽉".repeat(44), cta:"꽉".repeat(18)};
  const runtime = installedAdRuntime(process.cwd());
  for (const placement of ["feed-square","feed-portrait","story","reel"]) {
    const spec = resolvePlacement("portrait", placement, placement === "reel" ? 1440 : 1080);
    const variant = {formatId:"thumbnail_subject", formatVersion:1, size:spec.size,
      design:{placement,outputWidth:spec.width,font:"original",card:"original"},
      asset:{path:"demo/photo.png",w:1536,h:1024,subjectBox:[128,12,1414,1024]},
      appeal:{id:"test",meaning:"일을 선택하는 순간"}, copy};
    const issues = imageVariantProblems(variant);
    assert.deepEqual(issues, [], placement);
    const preview = variant => new ImageResponse(createElement(ImageCreativeView, {variant,assetUrl:photo}),
      {width:spec.width,height:spec.height,fonts}).arrayBuffer();
    const expected = Buffer.from(await preview(variant));
    const mac = await renderAdPng(runtime,variant,photo);
    assert.ok(mac.equals(expected), placement + ": Mac file differs from the preview");
    const baseline = await sharp(mac).removeAlpha().raw().toBuffer();
    for (const field of ["headline","body","cta"]) {
      const next = {...variant,copy:{...copy,[field]:copy[field].slice(0,-1) + "갈"}};
      const image = await sharp(Buffer.from(await preview(next))).removeAlpha().raw().toBuffer();
      let changed = 0;
      const {x,y,width,height} = spec.safe;
      for (let i = 0; i < image.length; i += 3) {
        if (baseline[i] === image[i] && baseline[i+1] === image[i+1] && baseline[i+2] === image[i+2]) continue;
        const column = (i / 3) % spec.width, row = Math.floor(i / 3 / spec.width);
        assert.ok(column >= x && column < x + width && row >= y && row < y + height,
          placement + " " + field + " outside the safe zone");
        changed++;
      }
      assert.ok(changed > 35, placement + " lost the last glyph of " + field);
    }
  }
});

test("a measured subject grows in the safe frame without losing either edge of its action", async () => {
  const original = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><rect x="135" y="120" width="60" height="140" fill="#ee0000"/><rect x="205" y="120" width="60" height="140" fill="#007700"/></svg>');
  const photo = "data:image/png;base64," + (await sharp(original).png().toBuffer()).toString("base64");
  const spec = resolvePlacement("story");
  const base = {formatId:"thumbnail_subject", formatVersion:1, size:"story",
    copy:{headline:"어떤 일을 고를까요?",body:"고르는 순간에 강점이 보여요.",cta:"무료로 확인하기"},
    appeal:{id:"a",meaning:"고르는 순간"}, asset:{path:"demo/probe.png",w:400,h:400}};
  async function subjectPixels(variant) {
    const png = await renderAdPng(installedAdRuntime(process.cwd()),variant,photo);
    const data = await sharp(png).removeAlpha().raw().toBuffer();
    let red = 0, green = 0;
    for (let i = 0; i < data.length; i += 3) {
      const isRed = data[i] > 200 && data[i+1] < 24 && data[i+2] < 24;
      const isGreen = data[i] < 24 && data[i+1] > 95 && data[i+2] < 24;
      if (!isRed && !isGreen) continue;
      const x = i / 3 % spec.width, y = Math.floor(i / 3 / spec.width);
      assert.ok(x >= spec.safe.x && x < spec.safe.x + spec.safe.width && y >= spec.safe.y && y < spec.safe.y + spec.safe.height);
      if (isRed) red++;
      if (isGreen) green++;
    }
    return [red, green];
  }
  const full = await subjectPixels(base);
  const measured = await subjectPixels({...base,asset:{...base.asset,subjectBox:[135,120,265,260]}});
  assert.ok(full.every((pixels,i) => pixels > 100 && measured[i] > pixels * 2));
});

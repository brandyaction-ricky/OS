import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { applyMasterRecipe, exportMasterRecipe } from "../lib/image-creative/analyze-master.ts";
import { draftReferenceLayout } from "../lib/image-creative/reference-layout.ts";

test("saved replacement positions bind to the original file and adopt only the current project's asset path", async()=>{
  const jpg=await readFile(new URL("../public/image-format-test/master.jpg",import.meta.url));
  const image={src:"data:image/jpeg;base64,"+jpg.toString("base64")};
  const layout={...draftReferenceLayout({path:"first-project.jpg",w:1080,h:1350}),master:{v:1,background:"#ffffff",regions:[],headlineWeight:900}};
  const current={...layout,source:{...layout.source,path:"next-project.jpg"}};
  const file=await exportMasterRecipe(image,layout);
  assert.ok(!file.includes(layout.source.path));
  assert.deepEqual(await applyMasterRecipe(image,current,file),current);
  await assert.rejects(applyMasterRecipe({src:image.src.replace(/.{4}$/,"AAAA")},current,file),/원본 이미지와 달라요/);
  const edited=JSON.parse(file);
  edited.template.source=layout.source;
  await assert.rejects(applyMasterRecipe(image,current,JSON.stringify(edited)),/이 이미지에서/);
});

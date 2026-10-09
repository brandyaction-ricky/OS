import test from "node:test";
import assert from "node:assert/strict";
import { PERSONAL_VAULT_ROOTS, stableWikiLink } from "../lib/knowledge-vault.ts";
import { planVaultRestoration } from "../lib/knowledge-vault-restoration.ts";
import { extractWikiLinks, resolveWikiLink } from "../lib/knowledge-links.ts";
import { planFolderMove } from "../lib/knowledge-folders.ts";
const doc = {id:"sample-id", title:"기획", folder:"02_Wiki/채널분석", source_ref:"02_Wiki/채널분석/기획_절차.md", status:"draft", owner_id:"owner", current_version:1};

test("vault keeps the seven original roots without status or category remapping", () => {
  assert.deepEqual(PERSONAL_VAULT_ROOTS, ["00_Skills","01_Raw","02_Wiki","03_Content","04_개인","05_Projects","06_학습"]);
});
test("inserted ID links survive both rename and folder move, including alias and heading", () => {
  const link = stableWikiLink(doc);
  const moved = {...doc, title:"바뀐 제목", folder:planFolderMove([doc],"02_Wiki/채널분석","05_Projects/영상")[0].to};
  assert.equal(resolveWikiLink(extractWikiLinks(link)[0], [moved])?.id, doc.id);
  assert.equal(resolveWikiLink(`${doc.id}#기준|표시 제목`, [moved])?.id, doc.id);
  assert.equal(resolveWikiLink(doc.source_ref, [moved])?.id, doc.id);
  assert.equal(resolveWikiLink(doc.id, [{...moved,status:"archived"}]), undefined);
  assert.equal(resolveWikiLink(doc.id, []), undefined);
  assert.equal(stableWikiLink({...doc,title:"문서 [이름]|별칭\n"}), "[[sample-id|문서  이름  별칭]]");
});
test("restoration plan changes only proven folders, leaves identity and content untouched", () => {
  const rows = [{...doc, folder:"02_Wiki/콘텐츠/채널운영",content_md:"원문",category_id:"existing"}, {...doc,id:"new",source_ref:null}];
  const before=structuredClone(rows), result=planVaultRestoration(rows);
  assert.deepEqual(result.changes,[{id:doc.id,expectedVersion:1,from:rows[0].folder,to:doc.folder,sourceRef:doc.source_ref}]);
  assert.deepEqual(result.held,[{id:"new",reason:"missing-original-path"}]);
  assert.deepEqual(rows,before);
  assert.equal(planVaultRestoration([doc]).unchanged,1);
});
test("ambiguous paths, missing parents and invalid paths are held, not guessed", () => {
  assert.equal(planVaultRestoration([doc,{...doc,id:"duplicate"}]).held.length,2);
  assert.equal(planVaultRestoration([doc,{...doc,id:"other",owner_id:"other"}]).held.length,0);
  assert.equal(planVaultRestoration([{...doc,parent_document_id:"missing"}]).held[0].reason,"parent-conflict");
  for(const path of ["/02_Wiki/a.md","02_Wiki/../a.md","02_Wiki/a.png","04_개발/a.md"])
    assert.equal(planVaultRestoration([{...doc,source_ref:path}]).changes.length,0);
  assert.deepEqual(planVaultRestoration([{...doc,status:"archived"}]),{changes:[],held:[],unchanged:0});
});

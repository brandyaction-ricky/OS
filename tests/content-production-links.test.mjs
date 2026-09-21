import assert from "node:assert/strict";
import test from "node:test";
import { productionDocumentId, addProductionLink, removeProductionLink, readProductionLinks } from "../lib/content-production-links.ts";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = () => ({ id: id(1), version: 4, metadata: { planningHandoff: { productionFormat: "board" }, pipelineReviews: [{ synthetic: true }] } });
const doc = () => ({ id: id(2), title: "Synthetic document", version: 2, status: "draft" });
test("document link extracts only UUID, never fetches or stores pasted host", () => {
  assert.equal(productionDocumentId(id(2)), id(2));
  assert.equal(productionDocumentId(`https://synthetic.example.invalid/knowledge?document=${id(2)}`), id(2));
  for (const value of ["javascript:alert(1)", "https://synthetic.invalid/other?document=" + id(2),
    `https://user:pass@synthetic.invalid/knowledge?document=${id(2)}`, `https://synthetic.invalid/knowledge?document=${id(2)}&document=${id(3)}`, "invalid"]) assert.throws(() => productionDocumentId(value));
});
test("connecting preserves existing metadata, records next topic version, and never copies content or grants approval", () => {
  const topic = source(), before = structuredClone(topic); const result = addProductionLink(topic, doc(), "design");
  assert.deepEqual(topic, before); assert.equal(result.expectedVersion, 4);
  assert.deepEqual(result.metadata.planningHandoff, before.metadata.planningHandoff);
  assert.deepEqual(result.metadata.pipelineReviews, before.metadata.pipelineReviews);
  assert.deepEqual(result.metadata.productionDocumentLinks, [{ documentId: id(2), role: "design", documentVersion: 2, sourceVersion: 5 }]);
  assert.equal(JSON.stringify(result).includes("Synthetic document"), false);
  assert.deepEqual(Object.keys(result).sort(), ["expectedVersion", "id", "metadata"]);
});
test("corrupt, duplicate, over-limit or unsupported-role links are not overwritten", () => {
  for (const value of [null, {}, [{ documentId: id(2) }]]) {
    const topic = source(); topic.metadata.productionDocumentLinks = value;
    assert.equal(readProductionLinks(value), null); assert.throws(() => addProductionLink(topic, doc(), "design"));
  }
  const topic = source(); topic.metadata.productionDocumentLinks = addProductionLink(topic, doc(), "design").metadata.productionDocumentLinks;
  assert.throws(() => addProductionLink(topic, doc(), "manuscript"));
  assert.throws(() => addProductionLink(source(), doc(), "approved"));
  topic.metadata.productionDocumentLinks = Array.from({ length: 12 }, (_, n) => ({ documentId: id(n + 20), role: "design", documentVersion: 1, sourceVersion: 4 }));
  assert.throws(() => addProductionLink(topic, doc(), "design"));
  assert.deepEqual(readProductionLinks(undefined), []);
});
test("disconnect updates only the topic link and preserves original document and metadata", () => {
  const topic = source(), original = doc(); topic.metadata = addProductionLink(topic, original, "design").metadata;
  const result = removeProductionLink(topic, id(2)); assert.deepEqual(result.metadata.productionDocumentLinks, []);
  assert.deepEqual(original, doc()); assert.deepEqual(result.metadata.pipelineReviews, topic.metadata.pipelineReviews);
  assert.equal(topic.metadata.productionDocumentLinks.length, 1); assert.equal(result.expectedVersion, 4);
  assert.throws(() => removeProductionLink(topic, id(99)));
});

// Read through the employee's registered Brandy OS connection. An ephemeral session dispatches MCP reads without a model turn.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { imageAdProductsFromCanon, IMAGE_PRODUCT_CANON_TITLES } from "../lib/image-creative/products.ts";
import { warehouseChapterIds, referenceCatalogFromDocs, WAREHOUSE_INDEX_TITLE } from "../lib/image-creative/reference-canon.ts";

const unavailable = () => new Error("기존 Brandy OS MCP에서 최신 원문을 읽지 못했습니다.");

async function readUsingMcp(cli, options, read) {
  const child = spawn(cli, ["app-server", "--listen", "stdio://", ...options], {stdio:["pipe","pipe","ignore"]});
  const pending = new Map();
  let seq = 0;
  function cancel() {
    for (const reply of pending.values()) reply.reject(unavailable());
    pending.clear();
  }
  const deadline = setTimeout(() => {cancel(); child.kill("SIGKILL");}, 45_000);
  child.once("error", cancel);
  child.once("close", cancel);
  child.stdin.on("error", cancel);
  const lines = createInterface({input:child.stdout});
  lines.on("line", line => {
    let message;
    try { message = JSON.parse(line); } catch { cancel(); return; }
    const reply = pending.get(message.id);
    if (!reply || message.method) return;
    pending.delete(message.id);
    if (message.error) reply.reject(unavailable()); else reply.resolve(message.result);
  });
  function rpc(method, params) {
    const id = ++seq;
    return new Promise((resolve,reject) => {
      if (!child.stdin.writable || child.exitCode !== null) {reject(unavailable()); return;}
      pending.set(id,{resolve,reject});
      child.stdin.write(JSON.stringify({id,method,params})+"\n");
    });
  }
  try {
    await rpc("initialize",{clientInfo:{name:"os-image-canon",version:"1"},capabilities:{experimentalApi:true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const {thread} = await rpc("thread/start", {ephemeral:true,approvalPolicy:"never",sandbox:"read-only"});
    async function call(tool,args) {
      const result = await rpc("mcpServer/tool/call",{server:"brandy-os",threadId:thread.id,tool,arguments:args});
      if (result?.isError) throw unavailable();
      return JSON.parse(result.content.find(row=>row.type==="text").text);
    }
    return await read(call);
  } finally {
    clearTimeout(deadline);
    lines.close();
    child.kill();
  }
}

export function liveImageCatalogs(cli, options, sourceIds = new Map()) {
  async function readProducts(call) {
    // Exports may supply stable document IDs; their versions, facts and example appeals are never used.
    const docs = [];
    for (const title of IMAGE_PRODUCT_CANON_TITLES) {
      const ids = sourceIds.has(title) ? [sourceIds.get(title)] : await findTitles(call,title,"canonical");
      if (title!==IMAGE_PRODUCT_CANON_TITLES[2] && ids.length!==1) throw unavailable();
      for (const id of ids) docs.push(await getDocument(call,id));
    }
    const products = imageAdProductsFromCanon(docs);
    if (!products.length) throw unavailable();
    return {products};
  }
  async function findTitles(call,title,status) {
    const result = await call("search_knowledge",{query:title,top_k:20});
    if (result.degraded || !Array.isArray(result.results)) throw unavailable();
    return [...new Set(result.results.filter(r=>r.title===title && (!status || r.status===status)).map(r=>r.documentId))];
  }
  async function getDocument(call,id) {
    const {document} = await call("get_document",{document_id:id});
    if (!document || document.id!==id || typeof document.content_md!=="string" || !document.current_version) throw unavailable();
    return document;
  }
  async function readReferences(call) {
    const ids = sourceIds.has(WAREHOUSE_INDEX_TITLE) ? [sourceIds.get(WAREHOUSE_INDEX_TITLE)] : await findTitles(call,WAREHOUSE_INDEX_TITLE);
    if (ids.length!==1) throw unavailable();
    const index = await getDocument(call,ids[0]);
    const chapters = await Promise.all(warehouseChapterIds(index.content_md).map(id=>getDocument(call,id)));
    return referenceCatalogFromDocs(chapters);
  }
  const inFlight = new Map();
  return function readCatalog(kind) {
    if (kind!=="products" && kind!=="references") throw unavailable();
    if (!inFlight.has(kind)) inFlight.set(kind,readUsingMcp(cli,options,kind==="products" ? readProducts : readReferences).finally(()=>inFlight.delete(kind)));
    return inFlight.get(kind);
  };
}

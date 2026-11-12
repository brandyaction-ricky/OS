import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpClient, subscriptionCli, workOne } from "../public/myin-local/image-ad-subscription.mjs";

const jobId = "e99c3be1-5e5c-47f7-abe8-6fd6608fd863";
const lease = "52df8a27-5ff6-4e71-a96f-a47b297bc4cd";
const mcpUrl = "https://brandyaction-os.vercel.app/api/mcp?organizationId=" + jobId + "&key=bos_pat_fixture";
test("text-only worker uses owner MCP + a credential-isolated subscription subprocess; OS corrections stay on the same lease", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-subscription-test-"));
  try {
    const bin = join(dir, "claude");
    // No network, employee queue, credentials, or real model is used.
    await writeFile(bin, `#!/usr/bin/env node
const a=process.argv.slice(2); const assert=require('node:assert/strict');
if(a.includes('--version')) {console.log("2.1.339 (Claude Code)");process.exit(0);}
if(a.includes('--help')) {console.log('--safe-mode --strict-mcp-config --mcp-config --setting-sources --settings --disable-slash-commands --tools "" to disable all tools --permission-mode --permission-prompts --no-session-persistence --system-prompt');process.exit(0);}
for(const k of ['BRANDY_OS_MCP_BEARER','ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','OPENAI_API_KEY','CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(process.env[k], undefined);
for(const k of ['--safe-mode','--strict-mcp-config','--disable-slash-commands']) assert.ok(a.includes(k));
assert.equal(a[a.indexOf('--tools')+1],'');assert.deepEqual(JSON.parse(a[a.indexOf('--mcp-config')+1]),{mcpServers:{}});
if(a.includes('auth')) { console.log(JSON.stringify({loggedIn:true,authMethod:"claude.ai",apiProvider:"firstParty",subscriptionType:"max"}));process.exit(0); }
assert.equal(a[a.indexOf('--permission-mode')+1],'dontAsk');assert.ok(a.includes('--no-session-persistence'));
const text=require('node:fs').readFileSync(0,'utf8');assert.ok(!text.includes('bos_pat_')&&!text.includes('${lease}')&&!a.join('').includes('untrusted test brief'));
const {instructions,correction}=JSON.parse(text);assert.equal(instructions,'untrusted test brief');
console.log(JSON.stringify({subtype:"success",is_error:false,modelUsage:{"claude-sonnet-4-6":{}},result:JSON.stringify({items:[{id:correction?"note":"invalid",reason:"example"}]})}));
`, {mode:0o700});
    const calls = [];
    const call = mcpClient(mcpUrl, undefined, async (url, init) => {
      assert.equal(url.searchParams.has("key"),false); assert.equal(init.headers.Authorization,"Bearer bos_pat_fixture");
      assert.equal(init.redirect,"error");
      const { id, params }=JSON.parse(init.body); const args=params.arguments;
      calls.push(args.action || "list"); let result;
      if(params.name==="list_youtube_ai_jobs") {
        assert.deepEqual(args,{image_text_only:true});
        result={jobs:[{jobId,task:"script"},{jobId,task:"image-creative"},{jobId,task:"image-creative",imagePhase:"formats"}]};
      } else if(args.action==="claim") result={jobId,lease,task:"image-creative",imagePhase:"formats",instructions:"untrusted test brief"};
      else {
        assert.equal(args.lease,lease); assert.equal(args.model,"claude-sonnet-4-6");
        if(args.result.items[0].id==="invalid") return Response.json({jsonrpc:"2.0",id,result:{isError:true,structuredContent:{status:422},content:[{type:"text",text:"Select a known format."}]}});
        result={done:true};
      }
      return Response.json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(result)}]}});
    });
    const model=subscriptionCli(bin,dir,{...process.env,ANTHROPIC_API_KEY:"never-forward",ANTHROPIC_BASE_URL:"https://example.invalid",BRANDY_OS_MCP_BEARER:"never-forward"});
    assert.equal(await workOne({call,model}),"done"); assert.deepEqual(calls,["list","claim","complete","complete"]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

const exampleAppeals = [{id:"r",meaning:"회의 뒤 요청 기억하기"}];
const exampleFormats = [{id:"annotated",reason:"수첩에 남긴 한 곳을 본다."}];
for (const [phase, result] of [
  ["appeal-options", {appeals:exampleAppeals}],
  ["appeals", {appeals:exampleAppeals,items:exampleFormats}],
  ["concepts", {appeals:exampleAppeals,concepts:["무심코 돕는 순간을 돌아본다","내 행동으로 나를 본다"]}],
  ["scene", {scene:"회의가 끝난 테이블에서 두 사람이 노트 한 권을 함께 본다.",items:exampleFormats}],
]) test(`the subscription worker returns the ${phase} result for the claimed planning step`, async () => {
  const row = {jobId,task:"image-creative",imagePhase:phase};
  let submitted;
  const call = async (_, args) => {
    if (!args.action) return {jobs:[row]};
    if (args.action === "claim") return {...row,lease,instructions:"one proposed reason"};
    assert.equal(args.action,"complete");
    submitted = args.result;
    return {done:true};
  };
  const model = {check:async()=>{},generate:async()=>({model:"test",text:JSON.stringify(result)})};
  assert.equal(await workOne({call,model}),"done");
  assert.deepEqual(submitted,result);
});

test("missing model subscription or uncertain submit never consumes a second job or marks an uncertain result failed", async () => {
  const calls=[]; const row={jobId,task:"image-creative",imagePhase:"copy"};
  const call=async(_,args)=>{
    calls.push(args.action || "list");
    if(!args.action) return {jobs:[row]};
    if(args.action==="claim") return {...row,lease,instructions:"draft"};
    throw Error("connection lost after submit");
  };
  await assert.rejects(workOne({call,model:{check:async()=>{throw Error("no subscription");}}}),/no subscription/);
  assert.deepEqual(calls,["list"]); calls.length=0;
  await assert.rejects(workOne({call,model:{check:async()=>{},generate:async()=>({model:"example",text:'{"variants":[{}]}'})}}),/connection lost/);
  assert.deepEqual(calls,["list","claim","complete"]);
});

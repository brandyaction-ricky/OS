import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("trial reads one registered worker's eligible job without a lease, saved result, or publication",async()=>{
  const calls=[];
  const jobs=[{id:"sample",title:"원고 만들기",status:"backlog",stage:"queued",metadata:{proc:"topic"}}];
  const browser={id:"registered",name:"테스트 브라우저"};
  const modules={
    "./content-automation-v07":{
      assertHumanOwner(){return "tester";}, async getRegisteredBrowser(){calls.push("browser");return browser;},
      async getRunRules(){calls.push("rules");return {};},async listPersonalRecords(){calls.push("queue");return jobs;},
      orderedJobs(rows){calls.push("order");return rows;},
    },
    "./threads-reference":{getThreadsJobInput:()=>null},
    "@/lib/content-automation-results":{RESULT_EXAMPLES:{topic:"{}"}},
  };
  const compiled={exports:{}};
  const source=readFileSync(new URL("../lib/server/content-automation-worker.ts",import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module:compiled,exports:compiled.exports,require:name=>modules[name]??{}});
  const result=await compiled.exports.trialWorker({},{});
  assert.equal(result.job,jobs[0].title);
  assert.equal(result.browserId,browser.id);
  assert.deepEqual(calls,["browser","rules","queue","order"]);
  jobs[0].status="active";
  assert.equal((await compiled.exports.trialWorker({},{})).job,null);
});

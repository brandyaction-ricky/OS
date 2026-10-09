import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as model from '../lib/knowledge/model.ts';
import * as legacy from '../lib/knowledge/legacy.ts';
import * as access from '../lib/knowledge/access.ts';

function render(file,name,context,props={}){
  const exports={},box=({children})=>React.createElement('section',null,children);
  const modules={react:React,'react/jsx-runtime':jsx,'next/link':{default:({children,href})=>React.createElement('a',{href},children)},'next/navigation':{useRouter:()=>({replace(){}}),useSearchParams:()=>new URLSearchParams()},
    './provider':{useKnowledge:()=>context},'./ui':{Empty:box,Header:box,SpaceBadge:box},'./use-graph':{useWorkspaceGraph:()=>({graph:null})},
    '@/lib/knowledge/model':model,'@/lib/knowledge/legacy':legacy,'@/lib/knowledge/access':access};
  const source=ts.transpileModule(readFileSync(new URL('../components/knowledge/'+file,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,require:name=>modules[name]??{},URLSearchParams,console});
  return renderToStaticMarkup(React.createElement(exports[name],props));
}
const actor={ownerId:'owner',role:'member',type:'user',memberKind:'staff',active:true,allowedStatuses:['draft','team','canonical']};
test('failed workspace lists never imply zero documents or missing canon',()=>{
  const context={state:model.emptyKnowledgeState(),actor,loading:false,error:'read failed'};
  for(const [file,name,props] of [['database.tsx','CategoryDatabase',{space:'team'}],['canon.tsx','KnowledgeCanon',{}],['home.tsx','KnowledgeHome',{}]]){
    const html=render(file,name,context,props);assert.match(html,/다시 불러오기/);assert.doesNotMatch(html,/0개|없습니다|전체 정본|최근 연 문서/);
  }
});
test('initial list loading does not display empty data',()=>{
  const context={state:model.emptyKnowledgeState(),actor,loading:true,error:''};
  for(const [file,name,props] of [['database.tsx','CategoryDatabase',{space:'team'}],['canon.tsx','KnowledgeCanon',{}]]){
    const html=render(file,name,context,props);assert.match(html,/불러오는 중/);assert.doesNotMatch(html,/0개|없습니다|전체 정본/);
  }
});

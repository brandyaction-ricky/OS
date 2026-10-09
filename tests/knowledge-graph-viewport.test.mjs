import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const forceSource=readFileSync(new URL('../lib/knowledge/force.ts',import.meta.url),'utf8');
const force=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(forceSource,{module:ts.ModuleKind.ESNext})).toString('base64'));
const source=readFileSync(new URL('../lib/knowledge/graph-viewport.ts',import.meta.url),'utf8').replace('import { neighborIds } from "./force";',`const neighborIds=${force.neighborIds.toString()};`);
const {graphViewport}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
const options={spaces:['team','canon'],hideOrphans:false,selected:'',around:false,depth:1,full:false};
function fixture(size){return {nodes:Array.from({length:size},(_,i)=>({id:String(i),space:'team',status:'team',incoming:0,outgoing:0})),edges:[],broken:[]};}
test('large graph defaults to the most connected canonical document and two hops',()=>{
  const graph=fixture(1001);graph.nodes[500]={...graph.nodes[500],status:'canonical',space:'canon',outgoing:2};
  graph.edges=[{source:'500',target:'501'},{source:'501',target:'502'}];
  const view=graphViewport(graph,options);assert.equal(view.focusId,'500');assert.equal(view.automatic,true);assert.deepEqual(view.nodes.map(n=>n.id),['500','501','502']);
});
test('full view supports up to 2000 filtered nodes and larger sets stay bounded',()=>{
  const view=graphViewport(fixture(2000),{...options,full:true});assert.equal(view.nodes.length,2000);assert.equal(view.automatic,false);
  const restricted=graphViewport(fixture(2001),{...options,full:true});assert.equal(restricted.automatic,true);assert.ok(restricted.nodes.length<=1000);
});
test('threshold follows enabled spaces, not the total graph count',()=>{
  const graph=fixture(1500);graph.nodes.slice(200).forEach(n=>n.space='mine');
  const view=graphViewport(graph,options);assert.equal(view.automatic,false);assert.equal(view.nodes.length,200);
});
test('large neighborhood keeps the selected node even when it is last',()=>{
  const graph=fixture(1500);graph.edges=graph.nodes.slice(0,-1).map(n=>({source:'1499',target:n.id}));
  const view=graphViewport(graph,{...options,selected:'1499'});assert.equal(view.nodes.length,1000);assert.ok(view.nodes.some(n=>n.id==='1499'));assert.equal(view.truncated,true);
});

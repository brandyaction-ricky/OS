import test from 'node:test';
import assert from 'node:assert/strict';
import {saveLatest} from '../lib/save-latest.ts';
test('edits during a slow save are drained with the new server version without reverting current text',async()=>{
 let text='first',revision=1,version=7,release;const calls=[];
 const task=saveLatest(()=>({input:{text,version},revision}),async input=>{calls.push(input);if(calls.length===1)await new Promise(r=>release=r);return {text:input.text,version:input.version+1};},(result,rev)=>{version=result.version;if(rev!==revision)return false;text=result.text;return true;});
 text='second';revision++;text='latest';revision++;release();
 const result=await task;
 assert.deepEqual(calls,[{text:'first',version:7},{text:'latest',version:8}]);assert.equal(result.text,'latest');assert.equal(version,9);
});
test('failed save leaves the latest draft available for explicit retry',async()=>{
 let revision=1,text='first';const write=async()=>{text='latest';revision++;throw Error('offline');};
 await assert.rejects(saveLatest(()=>({input:text,revision}),write,()=>true),/offline/);
 assert.equal(text,'latest');assert.equal(await saveLatest(()=>({input:text,revision}),async x=>x,()=>true),'latest');
});

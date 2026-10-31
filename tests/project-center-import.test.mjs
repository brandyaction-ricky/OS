import test from 'node:test';import assert from 'node:assert/strict';
import {allowedProjectCenterOrigin,parseProjectCenterDocument} from '../lib/project-center-import.ts';
const nonce='01234567-1234-1234-1234-012345678901';
const doc={type:'pc-document',nonce,id:'note-1',title:'예시',content:'# 제목\n\n[첨부](https://example.com/a.pdf)',revision:'a'.repeat(64)};
test('only the exact Project Center origin is trusted',()=>{assert.ok(allowedProjectCenterOrigin('https://project-center.vercel.app'));for(const url of ['https://project-center.vercel.app.evil.test','https://evil.vercel.app','http://project-center.vercel.app','null','http://127.0.0.1:4181'])assert.equal(allowedProjectCenterOrigin(url),false);assert.ok(allowedProjectCenterOrigin('http://127.0.0.1:4181',true))});
test('transfer validates handshake and bounded document; rejects arbitrary objects',()=>{assert.deepEqual(parseProjectCenterDocument(doc,nonce),doc);for(const input of [null,{}, {...doc,nonce:'wrong'},{...doc,title:''},{...doc,content:'a'.repeat(1500001)},{...doc,revision:'bad'},{...doc,id:'../escape'}])assert.equal(parseProjectCenterDocument(input,nonce),null)});

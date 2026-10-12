import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function setup(overrides={}) {
 const timers=new Map();let stopped=0,closed=0,recorder,peer,channel;
 const track={stop(){stopped++},addEventListener(){}};
 const media={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const code=ts.transpileModule(readFileSync(new URL('../lib/knowledge/recording-controller.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};runInNewContext(code,{exports,Blob,AbortController,Date,Set,JSON,setTimeout(fn,ms){const id={fn,ms};timers.set(id,id);return id},clearTimeout(id){timers.delete(id)}});
 const deps={
  microphone:async()=>media,
  recorder:()=>recorder={state:'inactive',mimeType:'audio/webm',start(){this.state='recording'},stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic audio'])});this.onstop?.()}},
  peer:()=>peer={connectionState:'connected',addTrack(){},createDataChannel(){return channel={readyState:'open',sent:[],send(text){this.sent.push(JSON.parse(text))},close(){closed++}}},async createOffer(){return {type:'offer',sdp:'v=0\r\nm=audio'}},async setLocalDescription(){},async setRemoteDescription(){channel.onopen?.()},close(){closed++}},
  negotiate:async()=> 'v=0\r\nm=audio',transcribe:async()=> '복구한 합성 테스트 문장',...overrides,
 };
 const controller=new exports.MeetingRecordingController(deps);
 return {controller,get recorder(){return recorder},get channel(){return channel},get peer(){return peer},counts:()=>({stopped,closed}),timers,
  async flush(ms){for(const timer of [...timers.values()])if(timer.ms===ms){timers.delete(timer);timer.fn()}await new Promise(resolve=>setImmediate(resolve))},
  event(type,id,extra={}){controller.receive({type,item_id:id,...extra})}};
}
const commit=(s,id,previous=null)=>s.event('input_audio_buffer.committed',id,{previous_item_id:previous});
const final=(s,id,text)=>s.event('conversation.item.input_audio_transcription.completed',id,{transcript:text});

test('navigation unsubscribes a view without stopping microphone; original meeting consumes buffered text once',async()=>{
 const s=setup();await s.controller.start('meeting-a','합성 QA');
 let updates=0;const unsubscribe=s.controller.subscribe(()=>updates++);
 commit(s,'first');s.event('conversation.item.input_audio_transcription.delta','first',{delta:'녹음 중 바로'});
 assert.equal(s.controller.snapshot().parts[0].text,'녹음 중 바로');assert.equal(s.controller.snapshot().parts[0].final,false);
 unsubscribe();final(s,'first','녹음 중 바로 보이는 문장');
 commit(s,'second','first');final(s,'second','다른 메뉴에서 말한 문장');
 assert.equal(s.controller.snapshot().phase,'recording');assert.equal(s.counts().stopped,0);
 const received=[];s.controller.drain('meeting-b',text=>{received.push(text);return true});assert.equal(received.length,0);
 s.controller.drain('meeting-a',text=>{received.push(text);return true});
 assert.equal(received[0],'녹음 중 바로 보이는 문장\n\n다른 메뉴에서 말한 문장');
 s.controller.drain('meeting-a',text=>{received.push(text);return true});assert.equal(received.length,1);assert.ok(updates);
 s.controller.reset();assert.equal(s.counts().stopped,1);
});

test('out-of-order completions wait for prior turn and duplicate events never append twice',async()=>{
 const s=setup();await s.controller.start('a','QA');commit(s,'one');commit(s,'two','one');final(s,'two','둘째');
 const texts=[];s.controller.drain('a',text=>{texts.push(text);return true});assert.equal(texts.length,0);
 final(s,'one','첫째');s.controller.drain('a',text=>{texts.push(text);return true});assert.equal(texts[0],'첫째\n\n둘째');
 final(s,'two','중복');s.event('conversation.item.input_audio_transcription.delta','two',{delta:'늦은 이벤트'});
 s.controller.drain('a',text=>{texts.push(text);return true});assert.equal(texts.length,1);assert.equal(s.controller.snapshot().parts[1].text,'둘째');
 s.controller.reset();
});

test('memo length rejection keeps pending text for another attempt and rejects concurrent meetings',async()=>{
 const s=setup();await s.controller.start('a','QA');commit(s,'one');final(s,'one','보존할 문장');
 s.controller.drain('a',()=>false);assert.equal(s.controller.snapshot().parts[0].delivered,false);
 await assert.rejects(()=>s.controller.start('b','다른 회의'),/진행 중인 녹음/);
 s.controller.drain('a',()=>true);assert.equal(s.controller.snapshot().parts[0].delivered,true);s.controller.reset();
});

test('stop commits active speech, releases microphone immediately, and receives final text before closing realtime',async()=>{
 const s=setup();await s.controller.start('a','QA');s.event('input_audio_buffer.speech_started','one');
 s.controller.stop();assert.equal(s.counts().stopped,1);assert.equal(s.controller.snapshot().phase,'finishing');assert.equal(s.counts().closed,0);
 assert.equal(s.channel.sent[0].type,'input_audio_buffer.commit');commit(s,'one');final(s,'one','마지막 말');
 await s.flush(700);assert.equal(s.controller.snapshot().phase,'ready');assert.equal(s.controller.snapshot().audio,null);assert.ok(s.counts().closed>0);
});

test('failed realtime retains recording and recovery, retry does not duplicate already delivered live text',async()=>{
 let calls=0;const s=setup({transcribe:async()=>{if(++calls===1)throw new Error('offline');return '전체 복구 문장'}});
 await s.controller.start('a','QA');commit(s,'one');final(s,'one','이미 메모에 추가한 문장');s.controller.drain('a',()=>true);
 s.channel.onerror();assert.equal(s.controller.snapshot().phase,'recording');assert.equal(s.counts().stopped,0);
 s.controller.stop();await s.flush(700);assert.ok(s.controller.snapshot().audio);assert.match(s.controller.snapshot().error,/다시 시도/);
 await s.controller.retry();assert.equal(s.controller.snapshot().recovery,'전체 복구 문장');assert.equal(s.controller.snapshot().parts.length,1);assert.equal(s.controller.snapshot().audio,null);
});

test('unavailable realtime falls back to whole audio when there is no live text',async()=>{
 const s=setup({negotiate:async()=>{throw new Error('not configured')}});await s.controller.start('a','QA');s.controller.stop();await s.flush(8000);
 assert.equal(s.controller.snapshot().phase,'ready');const texts=[];s.controller.drain('a',text=>{texts.push(text);return true});assert.equal(texts[0],'복구한 합성 테스트 문장');
});

test('sign-out/disposal cancels a pending microphone grant and late transcription results cannot reappear',async()=>{
 let grant;const s=setup({microphone:()=>new Promise(resolve=>grant=resolve)});const starting=s.controller.start('a','QA');s.controller.reset();grant({getTracks:()=>[{stop(){}}]});await starting;
 assert.equal(s.controller.snapshot().phase,'idle');
 let resolve;const r=setup({negotiate:async()=>{throw new Error('offline')},transcribe:()=>new Promise(done=>resolve=done)});
 await r.controller.start('a','QA');r.controller.stop();await r.flush(8000);r.controller.reset();resolve('previous account text');await new Promise(done=>setImmediate(done));
 assert.equal(r.controller.snapshot().phase,'idle');assert.equal(r.controller.snapshot().parts.length,0);
});

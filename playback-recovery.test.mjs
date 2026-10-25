import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {lowerPlaybackQuality, playbackFailureMessage, switchRecoverableSource, isPlaybackAbort, bufferedPlaybackFailure} from './src/views/Play/playback-recovery.js';
import {replaceMediaEngine, releaseMediaEngine, isCurrentMediaEngine} from './src/views/Play/media-lifecycle.js';

const qualities = [{resolution:'1080',bitrate:8e6}, {resolution:'1080',bitrate:4e6}, {resolution:'720',bitrate:2e6}, {resolution:'4k',bitrate:3e6}];
assert.equal(lowerPlaybackQuality(qualities, qualities[0]), qualities[1]);
assert.equal(lowerPlaybackQuality(qualities, qualities[1]), qualities[2], 'Never move to a higher resolution');
assert.equal(lowerPlaybackQuality(qualities, qualities[2]), null);
assert.equal(lowerPlaybackQuality(qualities, {resolution:'unknown',bitrate:9e6}), null);
for (const error of [new Error('https://host/private?secret=fixture'), {response:{status:503}}, {category:'decode'}, {code:'PLAYBACK_TIMEOUT'}]) {
  assert.doesNotMatch(playbackFailureMessage(error), /https|secret|fixture/);
}
assert.match(playbackFailureMessage({response:{status:401}}), /登录/);
function player() {
  const events = new EventEmitter();
  return Object.assign(events, {video:{}, currentTime:0, url:'same', template:{$player:{classList:{remove(){}}}},
    pauses:0, plays:0, pause(){this.pauses++;}, async play(){this.plays++;}});
}
let art=player(); let task=switchRecoverableSource(art,'same',{position:33,paused:false});
art.emit('video:canplay'); await task; assert.equal(art.currentTime,33); assert.equal(art.plays,1); assert.equal(art.eventNames().length,0);
task=switchRecoverableSource(art,'fresh',{position:0,paused:true}); art.emit('video:canplay'); await task;
assert.equal(art.currentTime,0); assert.equal(art.plays,1);
task=switchRecoverableSource(art,'bad'); let rejected=assert.rejects(task); art.emit('fnos:media-error',{category:'network'}); await rejected; assert.equal(art.eventNames().length,0);
task=switchRecoverableSource(art,'timeout',{timeout:5}); await assert.rejects(task,{code:'PLAYBACK_TIMEOUT'}); assert.equal(art.eventNames().length,0);
let controller=new AbortController(); task=switchRecoverableSource(art,'cancel',{signal:controller.signal}); rejected=assert.rejects(task,{name:'AbortError'});controller.abort();await rejected;
assert.equal(art.eventNames().length,0); art.emit('video:canplay'); assert.equal(art.plays,1,'Late canplay cannot resume an abandoned source');
await assert.rejects(switchRecoverableSource(art,'unused',{signal:controller.signal}),{name:'AbortError'});
task=switchRecoverableSource(art,'startup');rejected=assert.rejects(task,{code:'PLAYBACK_TIMEOUT'});art.emit('fnos:media-error',{code:'PLAYBACK_TIMEOUT'});await rejected;

// Exercise the actual page recovery action, including single-flight and navigation guards.
const source=fs.readFileSync('./src/views/Play/VideoPlayer.vue','utf8');
const ctx=vm.createContext({recoveryState:{value:{episode:'one',position:42,paused:true,quality:qualities[0]}},recoveryBusy:{value:false},
  lowerRecoveryQuality:{value:qualities[1]},canRecoverExternally:{value:true},recoveryRun:0,initializationGeneration:0,
  episode_guid:{value:'one'},gallery_type:{value:'TV'},loading:{value:false},art:{},isPlaybackAbort,
  getVideoConfig:async()=>{},GetEpisodeList:async()=>{},reportPlaybackFailure(error,snapshot){ctx.recoveryState.value={...snapshot,message:playbackFailureMessage(error)};}});
let resolvePlay, calls=[],external=0,externalSnapshot;
ctx.play=options=>{calls.push(options);return new Promise(resolve=>resolvePlay=resolve);};ctx.openExternalPlayback=async snapshot=>{external++;externalSnapshot=snapshot;};
vm.runInContext(source.slice(source.indexOf('async function recoverPlayback('),source.indexOf('const IsFullscreen =')),ctx);
task=ctx.recoverPlayback('lower'); await ctx.recoverPlayback();assert.equal(calls.length,1);assert.equal(calls[0].quality.bitrate,4e6); assert.equal(calls[0].position,42);
resolvePlay();await task;assert.equal(ctx.recoveryBusy.value,false);
task=ctx.recoverPlayback('external');await task;assert.equal(external,1);assert.equal(externalSnapshot.position,42);assert.equal(calls.length,1,'External handoff owns its session without changing web playback');
task=ctx.recoverPlayback();ctx.initializationGeneration++;ctx.episode_guid.value='two';resolvePlay();await task;assert.equal(external,1,'Leaving the target cannot open a stale external modal');
ctx.recoveryBusy.value=false;ctx.episode_guid.value='one';ctx.play=async()=>{throw new Error('private URL');};
await ctx.recoverPlayback();assert.match(ctx.recoveryState.value.message,/暂时无法/);assert.equal(ctx.recoveryState.value.position,42);assert.equal(ctx.recoveryBusy.value,false);
ctx.art=null;let resolveConfig;ctx.getVideoConfig=()=>new Promise(resolve=>resolveConfig=resolve);
task=ctx.recoverPlayback();ctx.initializationGeneration++;resolveConfig();await task;assert.equal(calls.length,2,'Cancelled prerequisites cannot start a session');

// Actual engine callbacks ignore nonfatal and replaced-engine events.
class FakeHls {
  static Events={ERROR:'error'};static ErrorTypes={MEDIA_ERROR:'media'};
  on(event,handler){if(event==='error')this.handler=handler;}loadSource(){}attachMedia(){}destroy(){}
}
const engineEvents=[];const enginePlayer={fnosSourceGeneration:1,on(){},emit:(name,error)=>engineEvents.push({name,error})};
const engineContext=vm.createContext({Hls:FakeHls,replaceMediaEngine,releaseMediaEngine,isCurrentMediaEngine,
  watchPlaybackSource:()=>true,playbackSession:{generation:1}});
const start=source.indexOf('  customType: {')+'  customType: '.length;
vm.runInContext('globalThis.types='+source.slice(start,source.indexOf('  title: "",',start)).trim().replace(/,$/,''),engineContext);
engineContext.types.m3u8({},'fixture',enginePlayer);
// Retrieve the synthetic engine only through the imported lifecycle identity check.
let currentEngine;
engineContext.replaceMediaEngine=(player,create)=>replaceMediaEngine(player,()=>currentEngine=create());
engineContext.types.m3u8({},'first',enginePlayer);const oldEngine=currentEngine;
oldEngine.handler('error',{fatal:false,type:'network'});assert.equal(engineEvents.length,0);
oldEngine.handler('error',{fatal:true,type:'media'});assert.equal(engineEvents.at(-1).error.category,'decode');
engineContext.types.m3u8({},'second',enginePlayer);oldEngine.handler('error',{fatal:true,type:'network'});assert.equal(engineEvents.length,1);
currentEngine.handler('error',{fatal:true,type:'network'});assert.equal(engineEvents.at(-1).error.category,'network');

// A failed target must never report the previous video's position under its new ID.
ctx.art={currentTime:12,duration:30,playbackRate:1};ctx.recoveryState.value=null;ctx.sourceEpisode='old';
ctx.playInfo={value:{guid:'one'}};ctx.StreamList={value:{video_streams:[{guid:'video',media_guid:'file'}]}};
ctx.QualityData={value:qualities};ctx.currentQuality={value:qualities[2]};ctx.currentAudio={value:null};ctx.currentSubtitle={value:null};
ctx.urlBase={value:'fixture'};ctx.guid={value:'one'};
vm.runInContext(source.slice(source.indexOf('function playbackRecordSnapshot('),source.indexOf('async function SendPlayRecord(')),ctx);
assert.equal(ctx.playbackRecordSnapshot(),null);
ctx.sourceEpisode='one';assert.equal(ctx.playbackRecordSnapshot().bitrate,2e6);

const bufferedPlayer=player();let end=30,failed=[],resume=0,current=true;
bufferedPlayer.video={readyState:3,paused:false,ended:false,error:null,buffered:{length:1,start:()=>0,end:()=>end}};
bufferedPlayer.currentTime=12;let timer,online;
const guard=bufferedPlaybackFailure(bufferedPlayer,error=>failed.push(error),{isCurrent:()=>current,resume:()=>resume++,win:{
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},addEventListener:(name,fn)=>{online=fn;},removeEventListener:()=>{online=null;}}});
guard.notify({category:'network'});assert.equal(failed.length,0,'Future segment failure does not pause available buffer');
online();assert.equal(resume,1);bufferedPlayer.emit('fnos:network-ready');assert.equal(timer,null);
guard.notify({category:'network'});end=12;timer();assert.equal(failed.length,1,'Exhausted playable buffer exposes recovery');
end=30;guard.notify({category:'decode'});assert.equal(failed.length,2,'Decoder failures cannot continue buffered bytes');
guard.notify({category:'network'});current=false;timer();assert.equal(failed.length,2,'Old source cannot display a late failure');
guard.dispose();assert.equal(online,null);

console.log('PASS: bounded source recovery, zero progress and pause, strict lower quality, safe errors, duplicate clicks, navigation cancellation and fresh external handoff');

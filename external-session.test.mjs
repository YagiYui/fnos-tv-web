import assert from 'node:assert/strict';
import {createExternalSession} from './src/views/Play/external-session.js';
const calls=[];
const requests=async(method,path,auth,data)=>{
  calls.push({method,path,data});
  if(path.includes('play/info'))return {item:{guid:'episode',watched_ts:17}};
  if(path.includes('stream/list'))return {files:[{guid:'file',path:'/fixture.mkv'}],video_streams:[{guid:'video',codec_name:'h264'}],audio_streams:[],subtitle_streams:[]};
  if(path.includes('play/quality'))return [{resolution:'1080',bitrate:8e6},{resolution:'720',bitrate:2e6}];
  if(path.includes('play/play'))return {play_link:'/fixture-session'};
};
let result=await createExternalSession(requests,'episode',{preferFile:true});assert.deepEqual(result,{item_guid:'episode',media_guid:'file'});
assert.equal(calls.some(call=>call.path.includes('play/play')),false,'PotPlayer raw file does not create expiring transcoding sessions');
calls.length=0;result=await createExternalSession(requests,'episode',{preferFile:false,position:0,quality:{resolution:'720',bitrate:2e6}});
assert.deepEqual(result,{play_link:'/fixture-session'});assert.equal(calls.at(-1).data.startTimestamp,0);assert.equal(calls.at(-1).data.bitrate,2e6);
console.log('PASS: scoped original-file selection, no platform-dependent transcode session, separate HLS session and zero position');

// Raw playback is the default even if web play/info or quality is unavailable.
const rawCalls=[];
const raw=async(method,path,auth,data,options)=>{rawCalls.push(path);assert.equal(method,'GET');return {files:[{guid:'first',path:'/one'},{guid:'selected',path:'/two'}]}};
assert.deepEqual(await createExternalSession(raw,'movie',{mediaGuid:'selected'}),{item_guid:'movie',media_guid:'selected'});
assert.equal(rawCalls.length,1);
await assert.rejects(createExternalSession(raw,'movie',{mediaGuid:'removed'}),/已不可用/);
await assert.rejects(createExternalSession(async()=>({files:[]}),'movie'),/没有可用媒体文件/);
const controller=new AbortController();controller.abort();const count=rawCalls.length;
await assert.rejects(createExternalSession(raw,'movie',{signal:controller.signal}),{name:'AbortError'});assert.equal(rawCalls.length,count);
const late=new AbortController();await assert.rejects(createExternalSession(async()=>{late.abort();return {files:[{guid:'first'}]}},'movie',{signal:late.signal}),{name:'AbortError'});

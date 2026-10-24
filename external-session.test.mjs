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
let result=await createExternalSession(requests,'episode',{preferFile:true});assert.deepEqual(result,{media_guid:'file'});
assert.equal(calls.some(call=>call.path.includes('play/play')),false,'PotPlayer raw file does not create expiring transcoding sessions');
calls.length=0;result=await createExternalSession(requests,'episode',{position:0,quality:{resolution:'720',bitrate:2e6}});
assert.deepEqual(result,{play_link:'/fixture-session'});assert.equal(calls.at(-1).data.startTimestamp,0);assert.equal(calls.at(-1).data.bitrate,2e6);
console.log('PASS: scoped original-file selection, no Windows transcode session, separate HLS session and zero position');

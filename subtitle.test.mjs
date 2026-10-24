import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseSubtitlePlaylist, subtitlePayload, subtitleOptions, SegmentedSubtitleLoader, bindSubtitleTrack, subtitleSearchResults, downloadSubtitle, isPgsSubtitle, streamSubtitleGuid} from './src/views/Play/subtitle.js';

const base = 'http://nas:18080/fnos/v/media/session/subtitle.m3u8';
const playlist = '#EXTM3U\r\n#EXTINF:4.0,\r\na.vtt\r\n#EXTINF:8,\r\n/v/media/session/b.vtt\r\n#EXTINF:6,\r\nhttp://nas:5666/v/media/session/c.vtt\r\n';
const list = parseSubtitlePlaylist(playlist, base);
assert.equal(list.length, 3);
assert.equal(list[0].url, 'http://nas:18080/fnos/v/media/session/a.vtt');
assert.equal(list[1].url, 'http://nas:18080/fnos/v/media/session/b.vtt');
assert.equal(list[2].url, 'http://nas:18080/fnos/v/media/session/c.vtt');
assert.deepEqual(list.map(s => [s.start, s.end]), [[0, 4], [4, 12], [12, 18]]);
assert.throws(() => parseSubtitlePlaylist('{"code":-2}', base), /有效播放列表/);
assert.throws(() => subtitlePayload('{"code":-2}'), /WebVTT/);
const options = subtitleOptions([{guid:'one',index:0,title:'简中',codec_name:'ass'}, {guid:'two',index:0,title:'繁中',codec_name:'srt'}], 'two');
assert.equal(options.length, 3, 'Separate external files may both have index zero');
assert.equal(options[0].index, -1);
assert.equal(options[2].default, true);
const hlsTrack = {activeCues: []};
const realTrack = {activeCues: [{text: 'subtitle fixture'}]};
const player = {subtitle: {get textTrack() {return hlsTrack;}}, template: {$track: {track: realTrack}}};
assert.equal(player.subtitle.textTrack.activeCues.length, 0);
bindSubtitleTrack(player);
assert.equal(player.subtitle.textTrack.activeCues.length, 1);
const switchedTrack = {activeCues: [{text: 'new subtitle fixture'}]};
player.template.$track = {track: switchedTrack};
assert.equal(player.subtitle.textTrack, switchedTrack);
let time = 0;
const renders = [];
const vtt = name => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${name}\n`;
const loader = new SegmentedSubtitleLoader({getTime:()=>time, clear(){}, render:async t=>renders.push(t),
  fetchText:async u=>u.endsWith('.m3u8')?playlist:vtt(u.split('/').at(-1))});
await loader.setPlaylist(base);
assert.ok(renders[0].includes('a.vtt'));
time = 13; await loader.update(time);
assert.ok(renders.at(-1).includes('c.vtt'));
time = 0; await loader.update(time);
assert.ok(renders.at(-1).includes('a.vtt'));
loader.clear(); assert.equal(loader.cache.size, 0); assert.equal(loader.segments.length, 0);
let release;
const stale = new Promise(r=>release=r);
const r2=[];
const loader2 = new SegmentedSubtitleLoader({getTime:()=>0,clear(){},render:async t=>r2.push(t),fetchText:async u=>{
  if (u.includes('old.m3u8')) return stale;
  return u.endsWith('.m3u8')?'#EXTM3U\n#EXTINF:6,\nnew.vtt\n':vtt('NEW TRACK');
}});
const old = loader2.setPlaylist(base.replace('subtitle','old'));
await loader2.setPlaylist(base.replace('subtitle','new'));
release('#EXTM3U\n#EXTINF:6,\nold.vtt\n'); await old;
assert.equal(r2.length,1); assert.ok(r2[0].includes('NEW TRACK'));

const src = fs.readFileSync('./src/views/Play/VideoPlayer.vue','utf8');
const fn = src.slice(src.indexOf('async function switchSubtitle('), src.indexOf('async function addArtConfig('));
const calls=[];let switches=0;let clears=0;
const context={subtitleSwitchGeneration:0,serverSubtitleGuid:null,isPgsSubtitle,streamSubtitleGuid,art:{currentTime:27.9},urlBase:{value:'/v/media/session/preset.m3u8'},currentSubtitle:{value:null},
  subtitlePlaybackError:{value:''},subtitleTrackGuid:{value:''},
  playInfo:{value:{}},url:{value:''},subtitleErrorShown:false,subtitleLoader:{clear(){clears++}},
  COMMON:{requests:async(...a)=>{calls.push(a);return {result:'succ'}}},
  switchSubtitleUrl:async()=>switches++,UpdateControl:async()=>{},showSubtitleError:e=>{throw e}};
vm.createContext(context);vm.runInContext(fn,context);
await context.switchSubtitle({guid:'subtitle-one',index:4,html:'简中'});
assert.equal(calls[0][3].startTimestamp,27);assert.equal(calls[0][3].subtitleIndex,4);assert.equal(switches,1);
await context.switchSubtitle({guid:null,index:-1,html:'关闭字幕'});
assert.equal(calls[1][3].subtitleIndex,-1);assert.equal(context.currentSubtitle.value,null);assert.equal(switches,1);
assert.equal(clears,2);
const commonSrc = fs.readFileSync('./src/components/common.vue', 'utf8');
const rawFn = commonSrc.slice(commonSrc.indexOf('async function requestsText('), commonSrc.indexOf('function ShowMsg('));
let requestConfig;
const rawContext = {apiUrl:'/fnos/v', VueCookies:{get:()=> 'fixture-token'}, instanceRequestBase:c=>({...c, signed:true}), errorText:e=>e.msg, axios:{request:async c=>{requestConfig=c;return {data:'WEBVTT\n\nfixture'}}}};
vm.createContext(rawContext); vm.runInContext(rawFn,rawContext);
await rawContext.requestsText('/api/v1/subtitle/dl/subtitle-guid',{fmt:'vtt'});
assert.equal(requestConfig.headers.Authorization,'fixture-token');assert.equal(requestConfig.signed,true);assert.equal(requestConfig.params.fmt,'vtt');
rawContext.axios.request=async()=>({data:'{\"code\":-2,\"msg\":\"Auth Failed\"}'});
await assert.rejects(rawContext.requestsText('/api/v1/subtitle/dl/subtitle-guid'),/字幕鉴权失败/);
console.log('PASS: signed full-subtitle download, own text track binding, playlist URLs and durations, empty/auth responses, four-track selectors, track changes, seeking, stale responses, current play position, disabling subtitles');

const results = subtitleSearchResults({subtitles:[{trim_id:'online-1',filename:'fixture.srt',format:'srt'}, {trim_id:'online-2',filename:'other.ass',format:'ass'}]}, [{guid:'present',trim_id:'online-1'}]);
assert.equal(results[0].existingGuid,'present');assert.equal(results[1].format,'ASS');
let downloadArgs;
const downloaded = await downloadSubtitle(async(...args)=>{downloadArgs=args;return {guid:'new-sub',index:0}},'media-file',results[1]);
assert.equal(downloaded.guid,'new-sub');assert.deepEqual(downloadArgs,['POST','/api/v1/subtitle/download',true,{media_guid:'media-file',trim_id:'online-2',sync_download:1}]);
await assert.rejects(downloadSubtitle(async()=>null,'media-file',results[0]),/未返回轨道/);
await assert.rejects(downloadSubtitle(async()=>{},'media-file',{}),/缺少下载标识/);
assert.throws(()=>subtitleSearchResults({}),/格式异常/);

let rejectStale;
const staleFailure = new SegmentedSubtitleLoader({getTime:()=>0,clear(){},render:async()=>{},fetchText:()=>new Promise((_,reject)=>{rejectStale=reject})});
const staleJob=staleFailure.setPlaylist(base); staleFailure.clear(); rejectStale(new Error('HTTP 404'));
await staleJob; // 切换字幕后的旧 404 不应弹错。
const partialRenders=[];
const partial = new SegmentedSubtitleLoader({getTime:()=>0,clear(){},render:async text=>partialRenders.push(text),fetchText:async u=>{
  if(u.endsWith('.m3u8'))return '#EXTM3U\n#EXTINF:6,\na.vtt\n#EXTINF:6,\nb.vtt\n';
  if(u.endsWith('b.vtt'))throw new Error('HTTP 404');return vtt('AVAILABLE');
}});
await partial.setPlaylist(base);assert.ok(partialRenders[0].includes('AVAILABLE'));
await assert.rejects(partial.update(7),/404/);
// 下载的外挂字幕需要用 guid 创建播放会话，不能仅凭 index=0 选轨。
context.GetPalyUrl=async()=>{};context.art.switchUrl=async()=>{};
context.mediaP=async()=>{};
await context.switchSubtitle({...downloaded,forceReload:true,html:'downloaded'});
assert.equal(context.currentSubtitle.value.guid,'new-sub');assert.equal(calls.length,2);
console.log('PASS: subtitle search mapping, existing subtitle detection, download payload and errors, new subtitle session by guid, stale 404 suppression and current segment retention');

const flowCalls=[];const chosen=[];
const flow={StreamList:{value:{video_streams:[{media_guid:'actual-media-file'}],files:[{guid:'fallback-file'}],subtitle_streams:[]}},
  subtitleSearchBusy:{value:false},subtitleDownloadBusy:{value:false},subtitleSearchDone:{value:false},
  subtitleSearchGeneration:0,subtitleSearchError:{value:''},subtitlePlaybackError:{value:''},
  subtitleSearchLanguage:{value:'zh-CN'},subtitleResults:{value:[]},subtitleTrackGuid:{value:''},
  subtitleSearchResults,downloadSubtitle,errorText:e=>e.message,
  switchSubtitle:async item=>chosen.push(item),COMMON:{ShowMsg(){},requests:async(...args)=>{
    flowCalls.push(args);return args[1].endsWith('/search')?{subtitles:[{trim_id:'online-id',filename:'chosen.srt',format:'srt'}]}:{guid:'fresh-track',index:0};
  }}};
vm.createContext(flow);
vm.runInContext(src.slice(src.indexOf('function subtitleMediaGuid('),src.indexOf('const subtitleFontSize =')),flow);
await flow.searchSubtitles();assert.equal(flow.subtitleSearchDone.value,true);
assert.equal(flowCalls[0][3].media_guid,'actual-media-file');assert.equal(flowCalls[0][3].lan,'zh-CN');
await flow.useSearchedSubtitle(flow.subtitleResults.value[0]);
assert.equal(chosen[0].guid,'fresh-track');assert.equal(chosen[0].forceReload,true);
assert.equal(flow.StreamList.value.subtitle_streams[0].guid,'fresh-track');
await flow.useSearchedSubtitle(flow.subtitleResults.value[0]);assert.equal(flowCalls.length,2,'Already downloaded result must not be downloaded twice');
flow.COMMON.requests=async()=>{throw new Error('service unavailable')};await flow.searchSubtitles();
assert.equal(flow.subtitleSearchBusy.value,false);assert.equal(flow.subtitleSearchError.value,'service unavailable');
let finishSearch;flow.COMMON.requests=()=>new Promise(r=>finishSearch=r);
const changingEpisode=flow.searchSubtitles();flow.StreamList.value.video_streams[0].media_guid='other-media-file';
finishSearch({subtitles:[{trim_id:'stale',filename:'old.srt',format:'srt'}]});await changingEpisode;
assert.equal(flow.subtitleResults.value.length,0,'Old episode results must not be applied to another media file');
console.log('PASS: search/download/select integration, correct media file and language, no duplicate downloads, API errors and episode changes');

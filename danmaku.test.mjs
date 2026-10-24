import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {episodeDanmaku} from './src/compat.js';
const src=fs.readFileSync('./src/views/Play/VideoPlayer.vue','utf8');
const ref=value=>({value});
const queue=[];const calls=[];
const state={episode_guid:ref('episode-one'),guid:ref('season'),playInfo:ref({episode_number:2}),
 danmakuKeyword:ref('Fixture'),danmakuSearchSource:ref('360'),danmakuResults:ref([]),danmakuEpisodes:ref([]),
 danmakuSelectedEpisode:ref(null),danmakuSelectedSource:ref(null),danmakuBusy:ref(false),danmakuSearchDone:ref(false),danmakuSearchError:ref(''),
 danmakuQueryGeneration:0,danmakuRequestController:new AbortController(),danmakuApplyScope:ref('episode'),activeDanmakuSource:ref(''),danmakuLoadGeneration:0,allDanmaku:ref({}),danmuConfig:ref({loadedUntil:0}),lastDanmuLoadedUntil:-1,
 danmuTitleData:ref({}),episodeDanmaku,errorText:e=>e.message,URLSearchParams,
 VueCookies:{get:()=> 'fixture-token'},COMMON:{ShowMsg(){}},getVideoConfig:async()=>{},GetEmoji:async()=>{},
 art:{currentTime:55,layers:{update(){}},plugins:{artplayerPluginDanmuku:{config(){},load:async(...args)=>{queue.push(args)}}}},
 fetch:async(path,options)=>{calls.push([path,options]);return {ok:true,json:async()=>
  path.startsWith('/danmu/search')?{code:0,results:[{title:'Fixture',platform:'Platform',url:'https://video.example/ep1'}]}:
  path.startsWith('/danmu/episodes')?{code:0,episodes:[{number:'1',title:'First',url:'https://video.example/ep1'},{number:'2',title:'Second',url:'https://video.example/ep2'}]}:
  path.startsWith('/danmu/get')?[{time:7,text:'later'},{time:3,text:'earlier'}]:{code:0}}}
};
vm.createContext(state);vm.runInContext(src.slice(src.indexOf('async function danmakuRequest('),src.indexOf('const currentSubtitle')),state);
await state.searchDanmaku();assert.equal(state.danmakuResults.value.length,1);
await state.chooseDanmakuSource(state.danmakuResults.value[0]);assert.equal(state.danmakuSelectedEpisode.value,1,'Prefer current episode');
await state.useDanmakuEpisode();assert.equal(state.allDanmaku.value['2'][0].text,'earlier');assert.equal(state.danmuConfig.value.loadedUntil,54);
const saved=calls.find(([p])=>p==='/danmu/sources/preferences');assert.equal(JSON.parse(saved[1].body).guid,'episode-one');assert.equal(JSON.parse(saved[1].body).url,'https://video.example/ep2');
assert.equal(saved[1].headers.Authorization,'fixture-token');assert.equal(queue[0].length,0,'No argument clears the old plugin queue');
let finish;state.fetch=()=>new Promise(r=>finish=r);const old=state.searchDanmaku();state.episode_guid.value='episode-two';state.danmakuResults.value=[];
finish({ok:true,json:async()=>({code:0,results:[{title:'stale'}]})});await old;assert.equal(state.danmakuResults.value.length,0);
state.danmakuEpisodes.value=[{url:'https://video.example/ep1'}];state.danmakuSelectedEpisode.value=0;
state.fetch=async()=>({ok:true,json:async()=>[]});calls.length=0;await state.useDanmakuEpisode();
assert.match(state.danmakuSearchError.value,/未返回弹幕/);assert.equal(calls.length,0);
state.fetch=async()=>({ok:false,status:401,json:async()=>({code:-2,msg:'login expired'})});await assert.rejects(state.danmakuRequest('/danmu/select'),/login expired/);
let finishLoad;
state.art.plugins.artplayerPluginDanmuku.load=()=>new Promise(resolve=>{finishLoad=resolve;});
const previousRows=state.allDanmaku.value;
const stalePlugin=state.applyDanmakuRows([{time:0,text:'stale'}],2);
state.art=null;state.danmakuLoadGeneration++;finishLoad();await stalePlugin;
assert.equal(state.allDanmaku.value,previousRows,'A destroyed player cannot overwrite the new account after an awaited plugin load');
console.log('PASS: manual search, current episode choice, authenticated per-episode save, sorted rows, queue clearing, stale results, empty source rejection and API errors');

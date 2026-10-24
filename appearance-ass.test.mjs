import {playbackTitle, continuePlaybackRoute, playbackSelection} from './src/views/Play/player-presentation.js';
import {isLibraryActive} from './src/navigation.js';
import assert from 'node:assert/strict';
import {readThemePreference,isDarkTheme,applyDocumentTheme} from './src/theme.js';
import {AssRenderer, waitForAssSubtitle} from './src/views/Play/ass-renderer.js';
assert.equal(readThemePreference({getItem:()=>null}),'system');
assert.equal(readThemePreference({getItem:()=> 'invalid'}),'system');
assert.equal(readThemePreference({getItem:()=> 'light'}),'light');
assert.equal(isDarkTheme('system',true),true);assert.equal(isDarkTheme('system',false),false);
assert.equal(isDarkTheme('light',true),false);assert.equal(isDarkTheme('dark',false),true);
globalThis.document={documentElement:{dataset:{},style:{}}};
applyDocumentTheme('system',true);assert.equal(document.documentElement.dataset.theme,'dark');
applyDocumentTheme('system',false);assert.equal(document.documentElement.dataset.theme,'light');
const libraries=['a','b','c','d'];
assert.deepEqual(libraries.filter(id=>isLibraryActive({path:'/list',query:{gallery_uid:'c'}},id)),['c']);
assert.equal(isLibraryActive({path:'/',query:{gallery_uid:'c'}},'c'),false);
let options;let disposed=0;
class Fake {constructor(opts){options=opts;this.canvas={classList:{add(){}}};this.canvasParent={style:{}};}dispose(){disposed++}}
const renderer=new AssRenderer({load:async()=>Fake});
const first=renderer.show({},'[Script Info]', {'example font':'/font.ttf'});await Promise.resolve();await Promise.resolve();
assert.equal(options.workerUrl,'/vendor/libass/subtitles-octopus-worker.js');
assert.deepEqual(options.fonts,[]);assert.deepEqual(options.availableFonts,{'example font':'/font.ttf'});
options.onReady();assert.equal(await first,true);renderer.clear();assert.equal(disposed,1);
const pending=renderer.show({},'second');await Promise.resolve();await Promise.resolve();renderer.clear();assert.equal(await pending,false);
const failure=renderer.show({},'third');await Promise.resolve();await Promise.resolve();options.onError(new Error('fixture failure'));
await assert.rejects(failure,/渲染失败/);
let lateFailure=0;const late=new AssRenderer({load:async()=>Fake,onFailure:()=>lateFailure++});
const loaded=late.show({},'fourth');await Promise.resolve();await Promise.resolve();options.onReady();await loaded;
options.onError(new Error('late error'));assert.equal(lateFailure,1);
let finish;const stale=new AssRenderer({load:()=>new Promise(resolve=>finish=resolve)});
const staleShow=stale.show({},'stale');stale.clear();finish(Fake);assert.equal(await staleShow,false);
console.log('PASS: system/light/dark preference, default system mode, document theme, ASS ready/error/late error/cancel/dispose and stale renderer handling');

assert.equal(playbackTitle({title:'出租车司机'},'Movie'),'出租车司机');
assert.equal(playbackTitle({title:'电影',episode_number:1},'Movie'),'电影');
assert.equal(playbackTitle({title:'开场',episode_number:1},'Episode'),'第1集：开场');
assert.equal(playbackTitle({title:'无集数'},'Episode'),'无集数');
assert.equal(playbackTitle(null,'Movie'),'');

const movieRoute=continuePlaybackRoute({type:'Movie',guid:'taxi',parent_guid:'library'});
assert.equal(movieRoute.query.guid,'taxi');
assert.equal(playbackSelection(movieRoute.query).episodeGuid,'taxi');
const episodeRoute=continuePlaybackRoute({type:'Episode',guid:'episode-3',parent_guid:'season'});
assert.equal(episodeRoute.query.guid,'season');
assert.equal(playbackSelection(episodeRoute.query).episodeGuid,'episode-3');
assert.equal(playbackSelection({gallery_type:'Episode',guid:'another-season'}).episodeGuid,null);
assert.equal(playbackSelection({gallery_type:'Movie',guid:'taxi',episode_guid:'stale-episode'}).episodeGuid,'taxi');

let requests=0, notices=0;
const pendingResult=await waitForAssSubtitle(async()=>++requests<3?{pending:true,retry_after:1}:{ass:'ready'},()=>true,{pause:async()=>{},onPending:()=>notices++});
assert.equal(pendingResult.ass,'ready');assert.equal(requests,3);assert.equal(notices,1);
let current=true;
assert.equal(await waitForAssSubtitle(async()=>({pending:true}),()=>current,{pause:async()=>{current=false}}),null);
let clock=0;
await assert.rejects(waitForAssSubtitle(async()=>({pending:true}),()=>true,{pause:async()=>{clock+=1000},now:()=>clock,timeout:1000}),/仍未准备/);

const pgs=new AssRenderer({kind:'pgs',load:async()=>Fake});
const imageSub=pgs.show({},'/danmu/subtitle-pgs-file/fixture');await Promise.resolve();await Promise.resolve();
assert.equal(options.subUrl,'/danmu/subtitle-pgs-file/fixture');assert.equal(options.subContent,undefined);options.onLoaded();assert.equal(await imageSub,true);pgs.clear();
// PGS creates its canvas asynchronously directly in the video parent. Never tag the whole player.
let delayedInstance;
class DelayedCanvas {constructor(opts){options=opts;delayedInstance=this;} dispose(){}}
const delayed = new AssRenderer({kind:'pgs',load:async()=>DelayedCanvas});
const delayedReady=delayed.show({},'/fixture.sup');await Promise.resolve();await Promise.resolve();
const tags=[];delayedInstance.canvas={classList:{add:tag=>tags.push(tag)},parentElement:{classList:{add:()=>{throw new Error('Player parent must stay visible');}}}};
options.onLoaded();assert.equal(await delayedReady,true);assert.ok(tags.includes('fnos-subtitle-overlay'));delayed.clear();

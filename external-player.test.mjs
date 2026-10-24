import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {externalPlayerLink,externalPlaylist} from './src/views/Play/external-player.js';
const media='http://nas:18005/danmu/external-play/fixture/preset.m3u8?x=1&y=2';
assert.equal(externalPlayerLink('nplayer',media),'nplayer-'+media);
assert.throws(()=>externalPlayerLink('potplayer',media));
const playlist=externalPlaylist(media,'Movie\n#EXT-X-KEY:bad');
assert.equal(playlist.split('\n').filter(line=>line.startsWith('http')).length,1);
assert.ok(playlist.endsWith(media+'\n'));
assert.equal(playlist.split('\n').length,4);
assert.throws(()=>externalPlaylist('file:///secret'));
assert.equal(new URL(externalPlayerLink('nplayer',media)).href.slice('nplayer-'.length),media);
assert.equal(new URL(externalPlayerLink('infuse',media)).searchParams.get('url'),media);
assert.equal(new URL(externalPlayerLink('iina',media)).searchParams.get('url'),media);
assert.match(externalPlayerLink('mxplayer',media),/;scheme=http;.*package=com.mxtech.videoplayer.ad;end$/);
assert.match(externalPlayerLink('vlc',media,'Android'),/package=org.videolan.vlc/);
assert.throws(()=>externalPlayerLink('potplayer','javascript:alert(1)'));
const source=fs.readFileSync(new URL('./src/views/Play/VideoPlayer.vue',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function openExternalPlayback('),source.indexOf('const loading = ref(true);'));
let payload;
const ctx=vm.createContext({URL,AbortController,externalGeneration:0,externalController:null,externalSessionLink:'',
  createExternalSession:async()=>({play_link:'/v/media/new-session/preset.m3u8'}),mediaP:async()=>{},preferExternalFile:false,
  playInfo:{value:{guid:'movie'}},currentQuality:{value:{resolution:'1080',bitrate:8e6}},currentAudio:{value:null},currentSubtitle:{value:null},device:{mediaCanPlay:{audioChannels:2}},
  externalBusy:{value:false},externalMediaUrl:{value:''},externalError:{value:''},showModal:{value:false},episode_guid:{value:'movie'},art:{currentTime:12,pause(){}},window:{location:{origin:'http://nas:18005'}},use_302_play:{value:false},url:{value:'/fnos/v/media/session/preset.m3u8'},urlBase:{value:'/v/media/session/preset.m3u8'},playUrl:{value:media},COMMON:{fnHost:'/fnos'},VueCookies:{get:()=> 'private-token'},errorText:e=>e.message,axios:{async post(path,body,options){payload={path,body,options};return {data:{code:0,data:{url:'/danmu/external-play/ticket/preset.m3u8'}}};}}});
vm.runInContext(source.slice(source.indexOf('function releaseExternalSession('),source.indexOf('function releaseExternalPlaylist(')),ctx);
vm.runInContext(fn+';globalThis.openExternal=openExternalPlayback;',ctx);
await ctx.openExternal();assert.equal(ctx.externalMediaUrl.value,'http://nas:18005/danmu/external-play/ticket/preset.m3u8');assert.equal(payload.body.play_link,'/v/media/new-session/preset.m3u8');assert.equal(ctx.urlBase.value,'/v/media/session/preset.m3u8','External session does not overwrite web session');assert.equal(payload.options.headers.Authorization,'private-token');assert.equal(ctx.externalBusy.value,false);
ctx.axios.post=async()=>{throw {response:{data:{msg:'登录失效'}}};};await ctx.openExternal();assert.equal(ctx.externalMediaUrl.value,'');assert.equal(ctx.externalError.value,'登录失效');
ctx.use_302_play.value=true;ctx.url.value='https://remote/file.mkv';ctx.playUrl.value=ctx.url.value;await ctx.openExternal();assert.equal(ctx.externalMediaUrl.value,'https://remote/file.mkv');
ctx.use_302_play.value=false;ctx.preferExternalFile=true;ctx.createExternalSession=async()=>({media_guid:'file-guid'});ctx.axios.post=async(path,body,options)=>{payload={path,body,options};return {data:{code:0,data:{url:'/danmu/external-play/ticket/media'}}};};await ctx.openExternal();assert.equal(payload.body.media_guid,'file-guid');assert.equal(payload.body.play_link,undefined);
console.log('PASS: temporary link preparation, credentials kept in request headers, error/retry state, public direct links, player schemes and encoded query URLs');

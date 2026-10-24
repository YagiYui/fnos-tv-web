import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PlaybackSession} from './src/views/Play/playback-session.js';
import {primaryMediaFile} from './src/views/Play/playback-metadata.js';
import {createPlayerPreferenceStore} from './src/views/Play/player-preferences.js';
import {chooseAudio, audioLabel, readPlayerPreference, writePlayerPreference, createAutoplayCountdown} from './src/views/Play/audio-tracks.js';
const tracks = [{guid:'en',language:'eng',codec_name:'aac',channels:2},
  {guid:'zh',language:'zho',codec_name:'ac3',channels:6,is_default:1}];
assert.equal(chooseAudio(tracks,'en','zho').guid,'zh');
assert.equal(chooseAudio(tracks,'en','unknown').guid,'en');
assert.equal(chooseAudio(tracks,null,'unknown').guid,'zh');
assert.equal(chooseAudio([],null,''),null);
assert.match(audioLabel(tracks[1]),/zho.*AC3.*6.*默认/);
assert.equal(audioLabel(null),'无音轨');
assert.equal(audioLabel({title:'<img onerror="bad">'}).includes('<img'),false);
const data = new Map();const storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
writePlayerPreference(storage,'one','audioLanguage','zho');
assert.equal(readPlayerPreference(storage,'one','audioLanguage',''),'zho');
assert.equal(readPlayerPreference(storage,'two','audioLanguage',''),'');
storage.getItem=()=>'{broken';assert.equal(readPlayerPreference(storage,'one','autoPlayNext',true),true);
const timers=new Map(),ticks=[];let id=0,advances=0;
const countdown=createAutoplayCountdown(value=>ticks.push(value),()=>advances++,fn=>{timers.set(++id,fn);return id;},key=>timers.delete(key));
const tick=()=>{const [key,fn]=timers.entries().next().value;timers.delete(key);fn();};
countdown.start(2);tick();countdown.cancel();assert.equal(timers.size,0);assert.equal(advances,0);
countdown.start(2);tick();tick();assert.equal(advances,1);assert.equal(ticks.at(-1),null);
countdown.start(2);countdown.start(1);assert.equal(timers.size,1);tick();assert.equal(advances,2);

const source = fs.readFileSync('./src/views/Play/VideoPlayer.vue', 'utf8');
const calls = [], messages = [];
const audioPreferencesStore = createPlayerPreferenceStore(() => storage);
const state = vm.createContext({Math, audioLabel, writePlayerPreference, primaryMediaFile,
  preferenceHandle: audioPreferencesStore.bindAccount('one'),
  savePlayerPreference: (name, value, handle) => handle.write(name, value),
  playbackSession: new PlaybackSession(), localStorage: storage,
  preferredAudioLanguage: {value: ''}, currentAudio: {value: tracks[0]},
  StreamList: {value: {audio_streams: tracks, video_streams: [{guid:'video',codec_name:'h264',bps:100}], files:[{guid:'file',path:'/movie.mkv'}]}},
  QualityData: {value: [{resolution:'1080'}]}, playInfo:{value:{watched_ts:12}}, currentSubtitle:{value:null},
  streamSubtitleGuid:()=>'', serverSubtitleGuid:'', GetChannels:async()=>2,
  art: {currentTime:35, loading:{show:false},video:{paused:true},switchUrl:async()=>{},pause(){calls.push('paused');}},
  urlBase:{value:'/old'},url:{value:'/fnos/old'},playUrl:{value:'http://nas/old'},
  window:{location:{origin:'http://nas'}},use_302_play:{value:false},mediaP:async()=>{},
  COMMON:{fnHost:'/fnos',userKey:'one',ShowMsg:text=>messages.push(text),requests:async(method,path,auth,payload)=>{
    calls.push(payload);return {play_link:'/new'};
  }},errorText:error=>error.message});
const urlFlow = source.slice(source.indexOf('async function GetPalyUrl(startTimestamp'), source.indexOf('function playbackRecordSnapshot'));
const audioFlow = source.slice(source.indexOf('async function switchAudio('), source.indexOf('async function GetSkipList'));
vm.runInContext(urlFlow + audioFlow, state);
await state.switchAudio({guid:'zh'});
assert.equal(calls[0].audio_guid,'zh');assert.equal(calls[0].startTimestamp,35);
assert.equal(state.currentAudio.value.guid,'zh');assert.equal(state.playInfo.value.watched_ts,35);
assert.equal(calls.includes('paused'),true);
state.COMMON.requests = async()=>{throw new Error('fixture failure');};
await state.switchAudio({guid:'en'});
assert.equal(state.currentAudio.value.guid,'zh');assert.equal(state.urlBase.value,'/new');assert.equal(messages.length,1);
state.COMMON.requests=async(method,path,auth,payload)=>{calls.push(payload);return {play_link:'/silent'};};
state.currentAudio.value=null;
await state.GetPalyUrl(0);
assert.equal(calls.at(-1).audio_guid,'');
// A completed source switch must not save an old account's language after A -> B -> A.
state.currentAudio.value = tracks[1];
let finishSwitch;
state.art.switchUrl = () => new Promise(resolve => { finishSwitch = resolve; });
const lateAudio = state.switchAudio({guid:'en'});
while (!finishSwitch) await Promise.resolve();
state.playbackSession.cancel();
audioPreferencesStore.bindAccount('two');
state.preferenceHandle = audioPreferencesStore.bindAccount('one');
finishSwitch(); await lateAudio;
assert.equal(data.get('fnosPlayer:one:audioLanguage'), '"zho"');
console.log('PASS: audio language/default/no-audio, account-scoped preferences and cancelable autoplay countdown');

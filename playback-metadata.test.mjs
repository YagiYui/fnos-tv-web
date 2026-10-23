import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {loadPlaybackMetadata, primaryMediaFile} from './src/views/Play/playback-metadata.js';
import {PlaybackSession} from './src/views/Play/playback-session.js';
import {chooseAudio} from './src/views/Play/audio-tracks.js';
import {nextEpisode} from './src/views/Play/player-presentation.js';

const settle = () => new Promise(setImmediate);
const info = id => ({item: {guid: id, episode_number: id === 'one' ? 1 : 2, watched_ts: 17, audio_guid: 'zh', subtitle_guid: 'sub'}});
const streams = {files: [{guid: 'remote', path: '1-2-remote.mkv'}, {guid: 'file', path: '/local.mkv'}],
  video_streams: [{guid: 'video', codec_name: 'h264', bps: 500}],
  audio_streams: [{guid: 'en', language: 'eng'}, {guid: 'zh', language: 'chi', channels: 6}],
  subtitle_streams: [{guid: 'other', is_default: 1}, {guid: 'sub'}]};
const qualities = [{resolution: '1080', bitrate: 500, progressive: true}];
function requestsFixture() {
  const calls = [];
  const requests = (method, path, auth, data, options) => new Promise((resolve, reject) => {
    const call = {method, path, data, signal: options.signal, resolve, reject}; calls.push(call);
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {name: 'AbortError'})), {once: true});
  });
  return {requests, calls, last: () => calls.at(-1)};
}
let api = requestsFixture();
let pending = loadPlaybackMetadata(api.requests, 'two');
assert.deepEqual(api.calls.map(call => call.path), ['/api/v1/play/info', '/api/v1/stream/list/two?before_play=1']);
api.calls[1].resolve(streams); await settle();
assert.equal(api.last().path, '/api/v1/play/quality');
assert.equal(api.last().data.media_guid, 'file');
api.last().resolve(qualities); await settle();
api.calls[0].resolve(info('two'));
let result = await pending; assert.equal(result.info.item.guid, 'two'); assert.equal(result.streams, streams);
assert.equal(primaryMediaFile({files: streams.files.slice(0, 1)}).guid, 'remote');

api = requestsFixture(); pending = loadPlaybackMetadata(api.requests, 'two', {initialInfo: info('two')});
assert.equal(api.calls.length, 1, 'Resolved initial episode info is reused without a duplicate read');
api.last().resolve(streams); await settle(); api.last().resolve(qualities); await pending;

api = requestsFixture(); pending = loadPlaybackMetadata(api.requests, 'two');
let rejected = assert.rejects(pending, /fixture failure/);
api.calls[0].reject(new Error('fixture failure')); await rejected;
assert.equal(api.calls[1].signal.aborted, true, 'One failed read aborts its sibling');
assert.equal(api.calls.length, 2, 'No quality or playback request is made after failure');
api = requestsFixture(); const parent = new AbortController();
pending = loadPlaybackMetadata(api.requests, 'two', {signal: parent.signal});
rejected = assert.rejects(pending, {name: 'AbortError'}); parent.abort(); await rejected;
assert.equal(api.calls.every(call => call.signal.aborted), true);
api = requestsFixture(); await assert.rejects(loadPlaybackMetadata(api.requests, 'two', {signal: parent.signal}), {name: 'AbortError'});
assert.equal(api.calls.length, 0, 'Already cancelled operation starts no work');
api = requestsFixture(); pending = loadPlaybackMetadata(api.requests, 'two');
rejected = assert.rejects(pending, /不匹配/); api.calls[0].resolve(info('one')); await rejected;
assert.equal(api.calls[1].signal.aborted, true);
api = requestsFixture(); pending = loadPlaybackMetadata(api.requests, 'two');
rejected = assert.rejects(pending, /视频流/); api.calls[1].resolve({files: []}); await rejected;
assert.equal(api.calls.length, 2);
api = requestsFixture(); pending = loadPlaybackMetadata(api.requests, 'two');
rejected = assert.rejects(pending, /画质/); api.calls[1].resolve(streams); await settle(); api.last().resolve([]); await rejected;

// Exercise shipped play/next handlers with actual metadata and link request code.
const source = fs.readFileSync(new URL('./src/views/Play/VideoPlayer.vue', import.meta.url), 'utf8');
function player() {
  const api = requestsFixture(), events = [], notices = [];
  const ctx = {loadPlaybackMetadata, primaryMediaFile, chooseAudio, nextEpisode, AbortController,
    playbackSession: new PlaybackSession(), subtitleSwitchGeneration: 0, danmakuLoadGeneration: 0, subtitleSearchGeneration: 0,
    autoplayCountdown: {cancel() {}}, timerSendPlayRecord: {value: null}, clearInterval() {},
    guid: {value: 'season'}, episode_guid: {value: 'one'}, gallery_type: {value: 'TV'},
    EpisodeList: {value: [{guid: 'one', episode_number: 1}, {guid: 'two', episode_number: 2}]},
    playInfo: {value: info('one').item}, StreamList: {value: {files: []}}, QualityData: {value: []},
    qualitySelector: {value: []}, currentQuality: {value: null}, currentAudio: {value: null}, currentSubtitle: {value: null},
    preferredAudioLanguage: {value: ''}, subtitleLoader: {clear() { events.push('clearSubtitle'); }},
    urlBase: {value: '/old'}, url: {value: '/fnos/old'}, playUrl: {value: 'http://nas/fnos/old'}, serverSubtitleGuid: '',
    window: {location: {origin: 'http://nas'}}, use_302_play: {value: false},
    streamSubtitleGuid: track => track?.guid || '', GetChannels: async () => 2,
    art: {loading: {show: false}, switchUrl: async url => events.push(['switch', url])},
    GetEmoji() {}, mediaP: async (...args) => events.push(args),
    SendPlayRecord: () => { events.push('progress'); return new Promise(() => {}); },
    COMMON: {requests: api.requests, fnHost: '/fnos', ShowMsg: text => notices.push(text)}, errorText: error => error.message};
  for (const key of ['stopAfterCurrent','showDanmakuSearch','danmakuResults','danmakuEpisodes','danmakuSearchDone','danmakuSearchError',
    'subtitleSearchBusy','showSubtitleSearch','subtitleResults','subtitleSearchDone','subtitleSearchError','subtitlePlaybackError']) ctx[key] = {value: null};
  const context = vm.createContext(ctx);
  const pieces = [
    source.slice(source.indexOf('function setQualityOptions('), source.indexOf('// 切换清晰度')),
    source.slice(source.indexOf('async function GetPayInfo('), source.indexOf('async function GetChannels(')),
    source.slice(source.indexOf('async function GetPalyUrl(startTimestamp'), source.indexOf('function playbackRecordSnapshot')),
    source.slice(source.indexOf('async function play()'), source.indexOf('async function switchSubtitleUrl('))
  ];
  vm.runInContext(pieces.join('\n'), context);
  return {api, ctx: context, events, notices};
}
let view = player(); pending = view.ctx.play_next();
assert.equal(view.ctx.art.loading.show, true, 'Next click shows loading before waiting for any request');
assert.equal(view.api.calls.length, 2, 'Info and streams start while progress report remains pending');
await view.ctx.play_next(); assert.equal(view.api.calls.length, 2, 'Double click does not create another transition');
assert.equal(view.ctx.playInfo.value.guid, 'one', 'Existing media state remains intact until all metadata is ready');
view.api.calls[1].resolve(streams); await settle();
assert.equal(view.api.last().path, '/api/v1/play/quality', 'Quality starts without waiting for info');
view.api.last().resolve(qualities); await settle();
assert.equal(view.api.calls.length, 3, 'Playback link waits for complete metadata');
view.api.calls[0].resolve(info('two')); await settle();
assert.equal(view.api.last().path, '/api/v1/play/play');
assert.equal(view.api.last().data.audio_guid, 'zh'); assert.equal(view.api.last().data.subtitle_guid, 'sub');
assert.equal(view.api.last().data.startTimestamp, 17);
view.api.last().resolve({play_link: '/new'}); await pending;
assert.equal(view.ctx.playInfo.value.guid, 'two'); assert.equal(view.ctx.art.loading.show, false);
assert.equal(view.events.some(event => event[0] === 'switch' && event[1] === '/fnos/new'), true);
assert.equal(view.events.some(event => event[0] === 'media.quit' && event[1] === '/old'), true);
view = player(); pending = view.ctx.play_next();
view.api.calls[0].reject(new Error('unavailable')); await pending;
assert.equal(view.ctx.episode_guid.value, 'one'); assert.equal(view.ctx.playInfo.value.guid, 'one');
assert.equal(view.ctx.art.loading.show, false); assert.match(view.notices[0], /unavailable/);
view = player(); const superseded = view.ctx.play_next();
view.ctx.episode_guid.value = 'three'; pending = view.ctx.play();
await superseded;
assert.equal(view.ctx.art.loading.show, true, 'Cancelled transition must not hide the new transition loading state');
assert.equal(view.api.calls.slice(0, 2).every(call => call.signal.aborted), true);
view.api.calls[3].resolve(streams); await settle(); view.api.last().resolve(qualities);
view.api.calls[2].resolve(info('three')); await settle(); view.api.last().resolve({play_link: '/third'}); await pending;
assert.equal(view.ctx.playInfo.value.guid, 'three');
assert.equal(view.events.filter(event => event[0] === 'switch').length, 1, 'Superseded metadata cannot switch the video');
assert.equal(view.notices.length, 0);
view = player(); view.ctx.episode_guid.value = null; pending = view.ctx.play();
assert.equal(view.api.calls.length, 1); view.api.last().resolve(info('two')); await settle();
assert.equal(view.api.calls.length, 2); assert.match(view.api.last().path, /stream\/list\/two/);
view.api.last().resolve(streams); await settle(); view.api.last().resolve(qualities); await settle();
view.api.last().resolve({play_link: '/initial'}); await pending;
assert.equal(view.api.calls.filter(call => call.path === '/api/v1/play/info').length, 1);
console.log('PASS: parallel playback metadata, early quality dependency, sibling cancellation, no duplicate initial info, actual next handlers preserve tracks/resume and progress nonblocking with immediate loading');

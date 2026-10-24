import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPlayerPreferenceStore} from './src/views/Play/player-preferences.js';
const source = fs.readFileSync('./src/views/Play/VideoPlayer.vue', 'utf8');
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const values = new Map([
  ['fnosPlayer:alice:playbackRate', '1.5'], ['fnosPlayer:alice:subtitleFontSize', '28'],
  ['fnosPlayer:alice:assSubtitles', 'false'], ['fnosPlayer:alice:use302', 'true'],
  ['fnosPlayer:alice:audioLanguage', '"zho"'], ['fnosPlayer:alice:autoPlayNext', 'false'],
]);
let failSave = false;
const storage = {getItem: key => values.get(key) ?? null, setItem(key, value) {
  if (failSave) throw new Error('QuotaError'); values.set(key, value);
}, removeItem: key => values.delete(key)};
const account = {account: '', revision: 0}, controls = new Map(), events = [], notices = [];
let accountChanged;
const ref = value => ({value});
const makePlayer = () => ({playbackRate: 1, currentTime: 12, video: {paused: true}, loading: {},
  subtitle: {style() {}}, controls: {remove() {}}, setting: {remove() {}},
  layers: {update() {}}, plugins: {artplayerPluginDanmuku: {reset() {}}}, pause() {events.push('pause');}});
const ctx = vm.createContext({ref, useBrowseSnapshots: () => account,
  createPlayerPreferenceStore: () => createPlayerPreferenceStore(() => storage),
  COMMON: {ShowMsg: value => notices.push(value), fnHost: '/fnos'}, art: makePlayer(),
  qualitySelector: ref([]), EpisodeList: ref(null), StreamList: ref(null), currentSubtitle: ref(null),
  stopAfterCurrent: ref(false), touchPlayer: false, autoplayCountdown: {cancel() {events.push('cancel');}},
  audioLabel: () => '音轨', switchAudio() {}, openSubtitleSearch() {}, openDanmakuSearch() {},
  VueCookies: {get: () => null}, addArtConfig: async (_, type, item) => controls.set(`${type}:${item.name}`, item),
  window: {location: {origin: 'http://fixture'}}, url: ref('/fnos/media'), urlBase: ref('/media'), playUrl: ref(''),
  GetPalyUrlBy302: async () => {},
  watch(_, callback) {accountChanged = callback;},
  initializationGeneration: 0, playbackSession: {cancel() {events.push('abort');}}, recoveryRun: 0,
  releaseExternalSession() {}, clearPlaybackRecovery() {}, bufferedRecovery: null,
  timerSendPlayRecord: ref(null), clearInterval() {}, releaseMediaEngine() {}, recoveryTarget: ref(null),
  playInfo: ref({watched_ts: 12}), loading: ref(true), playbackError: ref(''),
  onMountedFun: async () => events.push('initialize'),
});
vm.runInContext([
  part('const accountState =', 'const stopAfterCurrent'),
  source.match(/const useAssSubtitles = .*;/)[0],
  part('const subtitleFontSize =', 'let currentVttBlob'),
  part('async function UpdateControl(', 'async function play(options'),
  part('let playerMounted =', 'onBeforeRouteUpdate('),
].join('\n'), ctx);
const read = expression => vm.runInContext(expression, ctx);
assert.equal(read('preferenceHandle.isCurrent()'), false);
assert.equal(read('preferredAudioLanguage.value'), '');
account.account = 'alice'; account.revision++; accountChanged();
assert.equal(read('preferredAudioLanguage.value'), 'zho');
assert.equal(read('autoPlayNext.value'), false);
assert.equal(read('useAssSubtitles.value'), false);
assert.equal(read('subtitleFontSize.value'), 28);
assert.equal(read('use_302_play.value'), true);
assert.equal(events.includes('initialize'), false, 'Pre-mount binding does not start playback twice');
await ctx.UpdateControl(ctx.art);
await controls.get('setting:倍速设置').onSelect({rate: 1.8});
assert.equal(ctx.art.playbackRate, 1.8);
assert.equal(values.get('fnosPlayer:alice:playbackRate'), '1.8');
controls.get('setting:自动连播').onSwitch({switch: false});
controls.get('setting:ASS特效字幕').onSwitch({switch: false});
controls.get('setting:字幕大小').onChange({range: [32]});
await controls.get('setting:是否开启302').onSwitch({switch: true});
for (const [name, value] of [['autoPlayNext', 'true'], ['assSubtitles', 'true'],
  ['subtitleFontSize', '32'], ['use302', 'false']]) assert.equal(values.get(`fnosPlayer:alice:${name}`), value);
const staleSpeed = controls.get('setting:倍速设置'), staleAuto = controls.get('setting:自动连播');
read('playerMounted = true'); account.account = 'bob'; account.revision++; accountChanged();
assert.equal(ctx.art, null); assert.equal(events.includes('abort'), true); assert.equal(events.includes('initialize'), true);
assert.equal(read('autoPlayNext.value'), true); assert.equal(read('subtitleFontSize.value'), 20);
await staleSpeed.onSelect({rate: 3}); staleAuto.onSwitch({switch: true});
assert.equal(values.has('fnosPlayer:bob:playbackRate'), false);
assert.equal(read('autoPlayNext.value'), true, 'Destroyed menu cannot change new account state');
account.account = 'alice'; account.revision++; accountChanged();
assert.equal(read('subtitleFontSize.value'), 32);
await staleSpeed.onSelect({rate: 3});
assert.equal(values.get('fnosPlayer:alice:playbackRate'), '1.8', 'Old A menu stays invalid after A -> B -> A');
failSave = true;
read("savePlayerPreference('subtitleFontSize', 24); savePlayerPreference('subtitleFontSize', 26)");
assert.equal(notices.length, 1); assert.match(notices[0], /仅对本次有效/);
assert.equal(read("preferenceHandle.read('subtitleFontSize')"), 26);
account.account = ''; account.revision++; accountChanged();
assert.equal(read("savePlayerPreference('playbackRate', 2)"), false);

// Only explicit speed selection persists: ready/restart and temporary holds must not.
const rateHandler = part("  art.on('video:ratechange',", '  let lastSkipIndex');
assert.equal(rateHandler.includes('savePlayerPreference'), false);
const ready = part('async function ready()', 'const artF');
assert.match(ready, /!art.fnosTemporarySpeed.*preferenceHandle.read\('playbackRate'\)/);
assert.equal(/localStorage\.(playbackRate|use_302_play)/.test(source), false);
assert.equal(source.includes("localStorage.setItem('fnosAssSubtitles'"), false);
console.log('PASS: actual player settings, account readiness/transitions, stale menus, scoped saving and persistence failure feedback');

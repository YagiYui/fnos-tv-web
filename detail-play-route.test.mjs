import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, computed, reactive, watch, nextTick, effectScope} from 'vue';
import {mediaDetailTitle} from './src/views/Play/player-presentation.js';
import {BrowseSnapshots} from './src/browse-snapshots.js';

const snapshots = new BrowseSnapshots(); snapshots.setAccount('viewer');
const source = fs.readFileSync(new URL('./src/views/Video/VideoData.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
let destination, top = 0, handler;
const calls = [];
const COMMON = {userKey: 'viewer', imgUrl: '/images', requests: async (method, uri, auth, data, options) => {
  calls.push({uri, signal: options.signal});
  if (handler) return handler(uri, data, options);
  if (uri.startsWith('/api/v1/item/')) return {guid: uri.split('/').at(-1), title: 'cached title', posters: 'poster.webp'};
  if (uri === '/api/v1/play/info') return data.item_guid === 'movie' ? {type: 'Movie', item: {guid: 'movie', parent_guid: 'library'}}
    : {type: 'Episode', item: {guid: 'episode2', parent_guid: 'season'}};
  if (uri.includes('/person/')) return {list: [{name: 'cast', role: 'actor'}]};
  return [{guid: 'episode2'}];
}};
function mount(id = 'movie', type = 'Movie') {
  const route = reactive({query: {guid: id, gallery_type: type}});
  let mounted, leave, update, unmount;
  const scope = effectScope();
  const ctx = vm.createContext({ref, computed, watch, nextTick, AbortController, mediaDetailTitle,
    useBrowseSnapshots: () => snapshots,
    getCurrentInstance: () => ({appContext: {config: {globalProperties: {$COMMON: COMMON, $route: route, $router: {push: value => { destination = value; }}}}}}),
    inject: () => ({getTop: () => top, scrollTo: value => { top = value; }}),
    onBeforeRouteUpdate: cb => { update = cb; }, onBeforeRouteLeave: cb => { leave = cb; },
    onBeforeUnmount: cb => { unmount = cb; }, onMounted: cb => { mounted = cb; }});
  scope.run(() => vm.runInContext(source + ';globalThis.detail={Play,loadDetail,VideoDataInfo,playInfo,SeasonData,PersonList,EpisodeList,loadError};', ctx));
  return {detail: ctx.detail, route, mounted: () => mounted(), leave: () => leave(), update: () => update(),
    unmount: () => { unmount(); scope.stop(); }};
}
let view = mount(); await view.mounted(); view.detail.Play();
assert.equal(destination.query.guid, 'movie'); assert.equal(destination.query.gallery_type, 'Movie');
top = 315; view.leave(); view.unmount();
assert.equal(Object.hasOwn(snapshots.get('viewer', JSON.stringify(['detail','movie','Movie'])), 'playInfo'), false);
let finish;
handler = () => new Promise(resolve => { finish = resolve; });
top = 0; view = mount();
assert.equal(view.detail.VideoDataInfo.value.title, 'cached title', 'Metadata is present before mount and network completion');
assert.equal(view.detail.PersonList.value[0].name, 'cast');
assert.equal(view.detail.playInfo.value, null, 'Playback information must be refreshed');
const pending = view.mounted(); await nextTick(); await new Promise(setImmediate);
assert.equal(top, 315); assert.equal(view.detail.VideoDataInfo.value.posters, 'poster.webp');
view.leave(); view.unmount(); assert.equal(calls.at(-1).signal.aborted, true);
finish({guid: 'movie', title: 'late result'}); await pending;
assert.equal(snapshots.get('viewer', JSON.stringify(['detail','movie','Movie'])).info.title, 'cached title');
handler = null; view = mount('season', 'season'); await view.mounted(); view.detail.Play('episode3');
assert.equal(destination.query.guid, 'season'); assert.equal(destination.query.episode_guid, 'episode3');
// New route commits immediately; old requests can no longer replace its content.
let finishOld;
handler = () => new Promise(resolve => { finishOld = resolve; });
const old = view.detail.loadDetail(); view.update();
handler = null; view.route.query = {guid: 'movie', gallery_type: 'Movie'};
await nextTick(); await new Promise(setImmediate);
finishOld({guid: 'season', title: 'wrong old title'}); await old; await new Promise(setImmediate);
assert.equal(view.detail.VideoDataInfo.value.guid, 'movie');
assert.equal(view.detail.VideoDataInfo.value.title, 'cached title');
handler = async () => { throw new Error('offline'); };
await view.detail.loadDetail(); assert.equal(view.detail.VideoDataInfo.value.title, 'cached title');
assert.equal(view.detail.loadError.value, 'offline');
view.leave(); view.unmount(); handler = null;
snapshots.setAccount('other'); COMMON.userKey = 'other'; view = mount();
assert.equal(Object.keys(view.detail.VideoDataInfo.value).length, 0);
view.unmount();
console.log('PASS: actual detail restoration before network, fresh play routes, scroll restore, stale/aborted requests, committed route changes, offline retention and account isolation');

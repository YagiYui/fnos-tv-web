import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, reactive, computed, watch, nextTick, effectScope} from 'vue';
import {MediaActions, mediaFlag, seasonTargets} from './src/media-actions.js';
import {invalidateMediaCaches} from './src/media-state-cache.js';
import {BrowseSnapshots} from './src/browse-snapshots.js';
import {LibraryViews} from './src/library-views.js';
import {MediaSearch, createSearchState} from './src/media-search.js';
import {CatalogCache} from './src/catalog-cache.js';
import {mediaDetailTitle} from './src/views/Play/player-presentation.js';

const snapshots = new BrowseSnapshots(); snapshots.setAccount('viewer');
const views = new LibraryViews(); views.setAccount('viewer');
const search = new MediaSearch({state: reactive(createSearchState())}); search.setAccount('viewer');
Object.assign(search.state, {query: 'fixture', items: [{guid: 'movie', watched: 0}], status: 'success', limit: 42, scrollY: 440});
const catalog = new CatalogCache(); catalog.entries.set('cached', {});
const media = {info: {library: {list: [{guid: 'movie', played: 0}]}}, loading: {library: true}};
const snapshotsStore = {get: (...args) => snapshots.get(...args), save: (...args) => snapshots.save(...args), get revision() { return snapshots.revision; }};
views.save('viewer', 'library', {items: [{guid: 'movie'}], hasData: true, page: 2, scrollY: 610, filters: {watched: '0'}});
snapshots.save('viewer', 'home', {playList: [{guid: 'movie'}], scrollY: 410});
snapshots.save('viewer', JSON.stringify(['detail', 'movie', 'Movie']), {info: {guid: 'movie', watched: 0}});
const changes = ref(0), calls = [], flags = new Map([['movie', {watched: 0, is_favorite: 0}],
  ['ep1', {watched: 0}], ['ep2', {watched: 0}], ['ep3', {watched: 0}]]);
let episodeIds = ['ep1', 'ep2'], failId = '', waitWrites = false;
const waiting = [];
function item(id) { return {guid: id, type: id === 'movie' ? 'Movie' : id === 'season' ? 'Season' : 'Episode', title: id, posters: 'fixture.webp', local_number_of_episodes: id === 'season' ? episodeIds.length : 0, ...flags.get(id)}; }
const COMMON = {userKey: 'viewer', imgUrl: '/fixture', requests: async (method, path, auth, body, options) => {
  calls.push({method, path, body, signal: options?.signal});
  if (path === '/api/v1/item/favorite' || path === '/api/v1/item/watched') {
    if (waitWrites) await new Promise(resolve => waiting.push(resolve));
    if (body.item_guid === failId) throw new Error('fixture refused');
    const field = path.endsWith('/favorite') ? 'is_favorite' : 'watched';
    flags.get(body.item_guid)[field] = method === 'DELETE' ? 0 : 1;
    return;
  }
  if (path.startsWith('/api/v1/item/')) return item(path.split('/').at(-1));
  if (path === '/api/v1/play/info') return {type: body.item_guid === 'movie' ? 'Movie' : 'Episode', item: {guid: 'ep1', parent_guid: 'season'}};
  if (path.includes('/episode/list/')) return episodeIds.map((guid, index) => ({...item(guid), parent_guid: 'season', episode_number: index + 1}));
  if (path.includes('/person/list/')) return {list: []};
  if (path.includes('/search/list?')) return [item('movie')];
  return [];
}};
const actions = new MediaActions({requests: COMMON.requests, onInvalidate: event => {
  if (invalidateMediaCaches(event, {account: COMMON.userKey, revision: actions.revision, catalogCache: catalog,
    homeLoads: new Map(), media, libraryViews: views, browseSnapshots: snapshots, mediaSearch: search})) changes.value++;
}});
actions.setAccount('viewer');
const source = fs.readFileSync(new URL('./src/views/Video/VideoData.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
const settle = async () => { await nextTick(); await new Promise(setImmediate); };
let top = 0;
function mount(id, type) {
  let mounted, leaving, unmounting;
  const scope = effectScope();
  const proxy = {$COMMON: COMMON, $route: {query: {guid: id, gallery_type: type}}, $router: {push() {}}};
  const context = vm.createContext({ref, reactive, computed, watch, nextTick, AbortController, mediaFlag, seasonTargets, mediaDetailTitle,
    useBrowseSnapshots: () => snapshotsStore,
    inject: (key, fallback) => ({mediaActions: actions, mediaChanges: changes, pageScroll: {getTop: () => top, scrollTo: value => { top = value; }}}[key] || fallback),
    getCurrentInstance: () => ({appContext: {config: {globalProperties: proxy}}}),
    onMounted: cb => { mounted = cb; }, onBeforeRouteUpdate() {}, onBeforeRouteLeave: cb => { leaving = cb; }, onBeforeUnmount: cb => { unmounting = cb; }});
  scope.run(() => vm.runInContext(source + ';globalThis.detail={setFlag,openBatch,confirmBatch,stopBatch,loadDetail,VideoDataInfo,EpisodeList,favoriteState,watchedState,actionBusy,actionError,actionNote,batchConfirm,batchProgress,batchResult};', context));
  return {d: context.detail, mounted: () => mounted(), leave: () => leaving(), unmount: () => { unmounting(); scope.stop(); }};
}
let view = mount('movie', 'Movie'); await view.mounted();
await view.d.setFlag('movie', 'favorite', true);
assert.equal(view.d.favoriteState.value, true); assert.equal(view.d.actionNote.value, '已保存');
assert.equal(catalog.entries.size, 0);
const invalidated = views.get('viewer', 'library');
assert.equal(invalidated.hasData, false); assert.equal(invalidated.page, 2); assert.equal(invalidated.scrollY, 610);
assert.equal(invalidated.filters.watched, '0'); assert.equal(invalidated.items.length, 0);
assert.equal(snapshots.get('viewer', 'home').playList.length, 1, 'Continue-watching geometry stays available');
assert.equal(search.state.stale, true); assert.equal(search.state.items.length, 1);
await view.d.setFlag('movie', 'watched', true); assert.equal(view.d.watchedState.value, true);
assert.equal(media.info.library.list[0].played, undefined, 'Unverified badges are hidden without dropping images');
await search.submit(COMMON.requests, 'fixture', {preserve: true});
assert.equal(search.state.items[0].watched, 1); assert.equal(search.state.limit, 42); assert.equal(search.state.scrollY, 440);
assert.equal(search.state.stale, false);
// A different account's notification cannot invalidate the current cache.
catalog.entries.set('current', {});
assert.equal(invalidateMediaCaches({account: 'other', revision: actions.revision}, {account: 'viewer', revision: actions.revision}), false);
assert.equal(catalog.entries.size, 1);
view.leave(); view.unmount();

view = mount('season', 'season'); await view.mounted();
const writes = () => calls.filter(call => ['PUT', 'DELETE', 'POST'].includes(call.method) && ['/api/v1/item/favorite', '/api/v1/item/watched'].includes(call.path));
let count = writes().length;
view.d.openBatch(true); assert.equal(view.d.batchConfirm.value.ids.length, 2);
assert.equal(writes().length, count, 'Opening confirmation sends no writes');
view.d.batchConfirm.value = null; assert.equal(writes().length, count);
view.d.EpisodeList.value = view.d.EpisodeList.value.slice(0, 1); view.d.openBatch(true);
assert.match(view.d.actionError.value, /尚未完整/); assert.equal(writes().length, count);
await view.d.loadDetail(); view.d.openBatch(true); failId = 'ep2';
const batch = view.d.confirmBatch(); await view.d.confirmBatch(); await batch; failId = '';
assert.equal(writes().length, count + 2); assert.equal(view.d.batchResult.value.saved.length, 1);
assert.equal(view.d.batchResult.value.failed[0].title, 'ep2'); assert.equal(view.d.batchResult.value.failed[0].error, 'fixture refused');
assert.equal(view.d.EpisodeList.value[0].watched, 1); assert.equal(view.d.EpisodeList.value[1].watched, 0);
// An individual episode can be changed independently, without invoking the parent season.
await view.d.setFlag('ep2', 'watched', true);
assert.equal(view.d.EpisodeList.value[1].watched, 1);
assert.equal(writes().at(-1).body.item_guid, 'ep2');
episodeIds = ['ep1', 'ep2', 'ep3']; await view.d.loadDetail();
view.d.openBatch(false); waitWrites = true;
const stopping = view.d.confirmBatch(); await settle(); assert.equal(waiting.length, 2);
view.d.stopBatch(); waiting.splice(0).forEach(resolve => resolve()); await stopping; waitWrites = false;
assert.equal(view.d.batchResult.value.skipped.length, 1); assert.equal(view.d.actionBusy.value, '');
// Leaving stops future batch work, ignores old UI results, but still invalidates server-changed caches.
view.d.openBatch(true); waitWrites = true;
const leaving = view.d.confirmBatch(); await settle(); view.leave(); view.unmount();
const beforeChange = changes.value; waiting.splice(0).forEach(resolve => resolve()); await leaving; waitWrites = false;
assert.equal(view.d.batchResult.value, null); assert.ok(changes.value > beforeChange);
assert.equal(actions.pending.size, 0);
console.log('PASS: actual detail buttons and confirmation handlers, canonical refresh, cache invalidation with preserved query/position, partial batches, no writes before confirmation, independent episodes, stopping and leave cleanup');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, computed, watch, reactive, nextTick, effectScope} from 'vue';
import {LibraryViews} from './src/library-views.js';

const source = fs.readFileSync(new URL('./src/views/Video/VideoList.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
const views = new LibraryViews(); views.setAccount('viewer-one');
const calls = [], totals = {movies: 98, tv: 70};
let failure = false, deferred = null, top = 0;
function rows(payload) {
  const total = totals[payload.ancestor_guid];
  return {total, list: Array.from({length: Math.max(0, Math.min(48, total - (payload.page - 1) * 48))},
    (_, i) => ({guid: `${payload.ancestor_guid}-${payload.page}-${i}`}))};
}
const COMMON = {userKey: 'viewer-one', async requests(method, uri, auth, payload, options) {
  calls.push({payload: {...payload}, signal: options.signal});
  if (deferred) { const wait = deferred; deferred = null; return wait; }
  if (failure) throw new Error('fixture failure');
  return rows(payload);
}};
const settle = async () => { await nextTick(); await new Promise(setImmediate); };
function mount(gallery = 'movies') {
  let mounted, leaving, changing, unmounting;
  const route = reactive({query: {gallery_uid: gallery}});
  const scope = effectScope();
  const context = vm.createContext({ref, computed, watch, nextTick, AbortController,
    useMediaDbData: () => ({list: []}), useLibraryViews: () => views,
    inject: () => ({getTop: () => top, scrollTo: value => { top = value; }}),
    getCurrentInstance: () => ({appContext: {config: {globalProperties: {$COMMON: COMMON, $route: route}}}}),
    onMounted: cb => { mounted = cb; }, onBeforeRouteLeave: cb => { leaving = cb; },
    onBeforeRouteUpdate: cb => { changing = cb; }, onBeforeUnmount: cb => { unmounting = cb; }});
  scope.run(() => vm.runInContext(source + ';globalThis.pager={page,mode,order,MediaDbInfo,NextPage,BackPage,GetMediaDbInfos,listLoading,listError,hasNextPage};', context));
  return {p: context.pager, mounted: () => mounted(), leave: () => leaving(),
    unmount: () => { unmounting(); scope.stop(); },
    change: async gallery => { changing({query: {gallery_uid: gallery}}); top = 0; route.query.gallery_uid = gallery; await settle(); }};
}
let view = mount(), p = view.p;
await view.mounted(); assert.equal(p.page.value, 1);
await p.BackPage(); assert.equal(calls.length, 1);
await p.NextPage(); assert.equal(p.page.value, 2); assert.equal(calls.at(-1).payload.page, 2);
assert.equal(calls.at(-1).payload.exclude_grouped_video, 1); assert.equal(top, 0);
await p.NextPage(); assert.equal(p.page.value, 3); assert.equal(p.hasNextPage.value, false);
const count = calls.length; await p.NextPage(); assert.equal(calls.length, count);
await p.BackPage(); failure = true; await p.NextPage(); failure = false;
assert.equal(p.page.value, 2); assert.equal(p.MediaDbInfo.value[0].guid, 'movies-2-0');
assert.match(p.listError.value, /fixture failure/);
p.mode.value = 'sort_title'; await settle();
assert.equal(p.page.value, 1); assert.equal(calls.at(-1).payload.sort_column, 'sort_title');
await p.NextPage(); top = 475; view.leave(); view.unmount();

let finish; deferred = new Promise(resolve => { finish = resolve; });
view = mount(); p = view.p; top = 0;
const restoring = view.mounted(); await settle();
assert.equal(p.page.value, 2); assert.equal(p.mode.value, 'sort_title'); assert.equal(top, 475);
assert.equal(p.MediaDbInfo.value[0].guid, 'movies-2-0'); assert.equal(calls.at(-1).payload.page, 2);
top = 520; finish(rows(calls.at(-1).payload)); await restoring;
assert.equal(top, 520, 'A slow revalidation must not pull the user back to the old scroll position');
const beforeSwitch = calls.length;
await view.change('tv');
assert.equal(calls.length, beforeSwitch + 1, 'Applying a saved sort must not issue a second page-one request');
assert.equal(p.page.value, 1); assert.equal(p.mode.value, 'create_time');
assert.equal(p.MediaDbInfo.value[0].guid, 'tv-1-0');
await view.change('movies'); assert.equal(p.page.value, 2); assert.equal(p.mode.value, 'sort_title'); assert.equal(top, 520);

deferred = new Promise(resolve => { finish = resolve; });
const old = p.GetMediaDbInfos(3); const signal = calls.at(-1).signal;
await p.NextPage(); const latest = p.GetMediaDbInfos(1); await latest;
assert.equal(signal.aborted, true);
finish({total: 98, list: [{guid: 'stale'}]}); await old;
assert.equal(p.page.value, 1); assert.notEqual(p.MediaDbInfo.value[0].guid, 'stale');
await p.NextPage(); view.leave(); view.unmount(); totals.movies = 10;
view = mount(); p = view.p; await view.mounted();
assert.equal(p.page.value, 1, 'An out-of-range saved page falls back to a valid page');
assert.equal(p.MediaDbInfo.value.length, 10);
totals.movies = 98; await p.GetMediaDbInfos(2); totals.movies = 10;
await p.NextPage(); assert.equal(p.page.value, 1); assert.equal(p.MediaDbInfo.value.length, 10);

deferred = new Promise(resolve => { finish = resolve; });
const pending = p.GetMediaDbInfos(2);
views.setAccount('viewer-two'); COMMON.userKey = 'viewer-two';
view.leave(); view.unmount(); finish({total: 70, list: [{guid: 'foreign'}]}); await pending;
assert.equal(views.get('viewer-two', 'movies'), null, 'A departing old view cannot save data into a new account');
assert.notEqual(p.MediaDbInfo.value[0].guid, 'foreign');
for (let i = 0; i < 15; i++) views.save('viewer-two', String(i), {items: [], page: 1});
assert.equal(views.views.size, 12); assert.equal(views.get('viewer-two', '0'), null);
views.setAccount(''); assert.equal(views.views.size, 0);
console.log('PASS: actual list paging, sort reset, retry retention, per-library return state, preserved live scroll, shrinking libraries, abort/stale guards, account isolation and bounded memory');

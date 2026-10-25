import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, computed, watch, reactive, nextTick, effectScope} from 'vue';
import {LibraryViews} from './src/library-views.js';
import {listFavoriteMedia} from './src/media-actions.js';
import {libraryViewKey} from './src/navigation.js';
import * as catalogFilters from './src/catalog-filters.js';

const source = fs.readFileSync(new URL('./src/views/Video/VideoList.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
const views = new LibraryViews(); views.setAccount('viewer-one');
const calls = [], totals = {movies: 98, tv: 70, '@favorites': 98};
let failure = false, deferred = null, metadataDeferred = null, top = 0;
function rows(payload) {
  const total = payload.tags?.watched === '0' ? 65 : totals[payload.ancestor_guid || '@favorites'];
  return {total, list: Array.from({length: Math.max(0, Math.min(48, total - (payload.page - 1) * 48))},
    (_, i) => ({guid: `${payload.ancestor_guid || 'favorites'}-${payload.page}-${i}`}))};
}
const COMMON = {userKey: 'viewer-one', async requests(method, uri, auth, payload, options) {
  calls.push({uri, payload: {...payload}, signal: options.signal});
  if (uri.startsWith('/api/v1/tag/')) {
    if (metadataDeferred) return metadataDeferred;
    if (failure) throw new Error('fixture metadata failure');
    return uri.includes('/tag/list?') ? {genres: [7], decades: ['2010s']} : [{id: 7, value: '剧情'}];
  }
  if (deferred) { const wait = deferred; deferred = null; return wait; }
  if (failure) throw new Error('fixture failure');
  return rows(payload);
}};
const settle = async () => { await nextTick(); await new Promise(setImmediate); };
function mount(gallery = 'movies') {
  let mounted, leaving, changing, unmounting;
  const route = reactive({query: gallery === '@favorites' ? {scope: 'favorites'} : {gallery_uid: gallery}});
  const changes = ref(0);
  const scope = effectScope();
  const context = vm.createContext({ref, computed, watch, nextTick, AbortController, listFavoriteMedia, libraryViewKey, ...catalogFilters,
    useMediaDbData: () => ({list: []}), useLibraryViews: () => views,
    inject: (key, fallback) => key === 'pageScroll' ? {getTop: () => top, scrollTo: value => { top = value; }} : key === 'mediaChanges' ? changes : fallback,
    getCurrentInstance: () => ({appContext: {config: {globalProperties: {$COMMON: COMMON, $route: route}}}}),
    onMounted: cb => { mounted = cb; }, onBeforeRouteLeave: cb => { leaving = cb; },
    onBeforeRouteUpdate: cb => { changing = cb; }, onBeforeUnmount: cb => { unmounting = cb; }});
  scope.run(() => vm.runInContext(source + ';globalThis.pager={page,mode,order,MediaDbInfo,NextPage,BackPage,GetMediaDbInfos,listLoading,listError,hasNextPage,openSort,closeSort,applyFilters,resetDraft,filters,draftFilters,draftMode,draftOrder,filterOptions,filterOptionsError,filterOptionsLoading,filterSummary,filterCount,resultsMatch};', context));
  return {p: context.pager, changes, mounted: () => mounted(), leave: () => leaving(),
    unmount: () => { unmounting(); scope.stop(); },
    change: async gallery => { const query = gallery === '@favorites' ? {scope: 'favorites'} : {gallery_uid: gallery}; changing({query}); top = 0; route.query = query; await settle(); }};
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

views.setAccount('viewer-one'); COMMON.userKey = 'viewer-one'; totals.movies = 98;
view = mount(); p = view.p; await view.mounted(); await p.NextPage();
const listCalls = () => calls.filter(call => call.uri === '/api/v1/item/list');
let before = listCalls().length;
p.openSort(); await settle();
p.draftFilters.value = {type: 'Movie', genres: 7, decade: '2010s', watched: '0'};
p.draftMode.value = 'sort_title'; p.closeSort();
assert.equal(listCalls().length, before); assert.equal(p.filterCount.value, 0);
p.openSort(); await settle(); assert.equal(p.draftFilters.value.watched, '', 'Closing discards unapplied changes');
p.draftFilters.value = {type: 'Movie', genres: 7, decade: '2010s', watched: '0'};
p.draftMode.value = 'sort_title'; await p.applyFilters(); await settle();
assert.equal(listCalls().length, before + 1, 'Apply batches sort and filters into one page-one request');
assert.equal(p.page.value, 1); assert.equal(p.resultsMatch.value, true);
assert.equal(listCalls().at(-1).payload.tags.watched, '0'); assert.equal(listCalls().at(-1).payload.tags.genres, 7);
assert.equal(p.filterCount.value, 4); assert.match(p.filterSummary.value, /剧情.*2010.*未看/);
await p.NextPage(); top = 620; view.leave(); view.unmount();
deferred = new Promise(resolve => { finish = resolve; }); top = 0;
view = mount(); p = view.p; const restoredFilters = view.mounted(); await settle();
assert.equal(p.page.value, 2); assert.equal(top, 620); assert.equal(p.filters.value.watched, '0');
assert.equal(p.mode.value, 'sort_title'); assert.match(p.filterSummary.value, /剧情/);
assert.equal(listCalls().at(-1).payload.tags.decade, '2010s');
top = 680; finish(rows(listCalls().at(-1).payload)); await restoredFilters; assert.equal(top, 680);
// Reset changes the draft only, then Apply restores the unfiltered defaults.
p.openSort(); await settle(); before = listCalls().length; p.resetDraft();
assert.equal(p.filterCount.value, 4); assert.equal(listCalls().length, before);
await p.applyFilters(); await settle();
assert.equal(p.page.value, 1); assert.equal(p.filterCount.value, 0); assert.equal(p.mode.value, 'create_time');
assert.equal(Object.hasOwn(listCalls().at(-1).payload.tags, 'watched'), false);
// Failure retains old cards with a mismatch state; Retry uses the failed page-one query.
await p.NextPage(); const oldItems = p.MediaDbInfo.value;
p.openSort(); await settle(); p.draftFilters.value.watched = '1'; failure = true;
await p.applyFilters(); failure = false;
assert.equal(p.page.value, 2); assert.equal(p.MediaDbInfo.value, oldItems); assert.equal(p.resultsMatch.value, false);
before = listCalls().length; await p.NextPage(); assert.equal(listCalls().length, before);
await p.GetMediaDbInfos(); assert.equal(listCalls().at(-1).payload.page, 1); assert.equal(p.page.value, 1);
assert.equal(p.resultsMatch.value, true);
// Apply invalidates an older list request before changing the visible query state.
p.openSort(); await settle(); p.draftFilters.value.watched = '0';
deferred = new Promise(resolve => { finish = resolve; });
const previousQuery = p.GetMediaDbInfos(2);
const obsoleteSignal = listCalls().at(-1).signal;
const applyingNewQuery = p.applyFilters();
assert.equal(obsoleteSignal.aborted, true);
finish({total: 98, list: [{guid: 'wrong-before-next-tick'}]});
await previousQuery; await applyingNewQuery;
assert.notEqual(p.MediaDbInfo.value[0].guid, 'wrong-before-next-tick');
assert.equal(p.filters.value.watched, '0');
// Restore watched=1 for the independent per-library checks below.
p.openSort(); await settle(); p.draftFilters.value.watched = '1'; await p.applyFilters();
// Switching libraries isolates both filters and metadata, ignoring delayed old metadata.
let finishMetadata; metadataDeferred = new Promise(resolve => { finishMetadata = resolve; });
p.openSort(); const oldSignals = calls.slice(-2).map(call => call.signal);
await view.change('tv'); assert.equal(p.filterCount.value, 0); assert.equal(p.filterOptionsLoading.value, false);
assert.equal(oldSignals.every(signal => signal.aborted), true);
finishMetadata({genres: [99], decades: ['Others']}); metadataDeferred = null; await settle();
assert.equal(p.filterOptions.value.genres.length, 0);
await view.change('movies'); assert.equal(p.filters.value.watched, '1');
failure = true; p.openSort(); await settle(); failure = false;
assert.match(p.filterOptionsError.value, /metadata failure/); assert.equal(p.filterOptionsLoading.value, false);
p.closeSort(); view.leave(); view.unmount();
const saved = views.get('viewer-one', 'movies'); saved.filters.watched = '0';
assert.equal(views.get('viewer-one', 'movies').filters.watched, '1', 'Draft edits cannot mutate cached state');
// Favorites reuse the list flow without leaking its internal scope key to the server.
view = mount('@favorites'); p = view.p; await view.mounted();
assert.equal(calls.at(-1).uri, '/api/v1/favorite/list');
assert.equal(Object.hasOwn(calls.at(-1).payload, 'ancestor_guid'), false);
await p.NextPage(); top = 710; view.leave(); view.unmount();
view = mount('@favorites'); p = view.p; await view.mounted();
assert.equal(p.page.value, 2); assert.equal(top, 710);
p.openSort(); await settle();
const metadata = calls.findLast(call => call.uri.startsWith('/api/v1/tag/list?'));
assert.match(metadata.uri, /is_favorite=1/); assert.doesNotMatch(metadata.uri, /ancestor_guid/);
p.draftFilters.value.watched = '1'; await p.applyFilters();
assert.equal(calls.at(-1).payload.tags.watched, '1'); assert.equal(p.page.value, 1);
await view.change('movies'); assert.equal(p.filters.value.watched, '1');
await view.change('@favorites'); assert.equal(p.filters.value.watched, '1');
deferred = new Promise(resolve => { finish = resolve; });
const oldFavorite = p.GetMediaDbInfos(2); const oldFavoriteSignal = calls.at(-1).signal;
views.invalidate(); view.changes.value++; await settle();
assert.equal(oldFavoriteSignal.aborted, true);
finish({total: 98, list: [{guid: 'old-favorite'}]}); await oldFavorite;
assert.notEqual(p.MediaDbInfo.value[0].guid, 'old-favorite'); assert.equal(p.resultsMatch.value, true);
await p.NextPage(); totals['@favorites'] = 10;
views.invalidate(); view.changes.value++; await settle(); await settle();
assert.equal(p.page.value, 1); assert.equal(p.MediaDbInfo.value.length, 10);
view.leave(); view.unmount();
console.log('PASS: actual pagination and filter handlers, batched apply, cancel/reset drafts, official payloads, query-aware failure retry, condition/page/scroll restoration, metadata abort/stale guards and per-library account memory');

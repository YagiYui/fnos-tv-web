import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, reactive} from 'vue';
import {CatalogCache} from './src/catalog-cache.js';
import {LibraryViews} from './src/library-views.js';
import {BrowseSnapshots} from './src/browse-snapshots.js';

const source = fs.readFileSync(new URL('./src/App.vue', import.meta.url), 'utf8');
const libraryList = ['first', 'second', 'offscreen'].map(guid => ({guid, category: 'Movie'}));
libraryList.push({guid: 'hidden', category: 'Others'});
const data = ref(libraryList), calls = [], cache = new CatalogCache(), waits = [];
const media = reactive({list: libraryList, info: {}, errors: {}, loading: {}, sort_column: 'create_time', sort_type: 'DESC'});
const COMMON = {requests: async (method, uri, auth, payload, options) => {
  calls.push({...payload});
  if (waits.length) return waits.shift()(options.signal);
  if (payload.ancestor_guid === 'second') throw new Error('one library failed');
  return {list: [{guid: payload.ancestor_guid}]};
}, ShowMsg: error => { throw new Error(error); }};
const search = {state: {query: ''}, setAccount() {}};
const context = vm.createContext({ref, COMMON, data, MediaDbData: media, initializedAccount: null,
  catalogCache: cache, homeLoads: new Map(), mediaSearch: search, libraryViews: new LibraryViews(),
  mediaActions: {setAccount() {}},
  browseSnapshots: new BrowseSnapshots(),
  route: {path: '/'}, UserInfo: ref({guid: 'viewer-one'}), VueCookies: {get: () => true}, MediaDbSum: ref({}),
  title: ref('示例服务器'), document: {title: ''}, initialization: null, metadataUpdated: 0, load: ref(true),
  getConfig: async () => {}, GetUserInfo: async () => {}, GetMediaDbSum: async () => { throw new Error('optional count unavailable'); },
  GetMediaDbList: async () => { data.value = libraryList; media.list = libraryList; }});
const handlers = source.slice(source.indexOf('async function loadHomeLibrary('), source.indexOf('const reF =')) +
  source.slice(source.indexOf('async function onMountedFun()'), source.indexOf('onMounted(async () =>'));
vm.runInContext(handlers, context);
await context.onMountedFun();
assert.equal(calls.length, 0, 'Initialization must not fetch every library');
assert.equal(context.load.value, false);
await context.loadHomeLibrary('first');
assert.equal(calls.length, 1); assert.equal(calls[0].page_size, 21);
assert.equal(media.info.first.list[0].guid, 'first'); assert.equal(media.loading.first, false);
await context.loadHomeLibrary('first'); assert.equal(calls.length, 1);
await context.loadHomeLibrary('second'); assert.match(media.errors.second, /one library failed/);
assert.equal(media.info.first.list.length, 1); assert.equal(media.info.offscreen, undefined);
await context.loadHomeLibrary('hidden'); assert.equal(calls.length, 2);
context.route.path = '/player'; await context.loadHomeLibrary('offscreen'); assert.equal(calls.length, 2);
context.route.path = '/'; search.state.query = '示例';
await context.loadHomeLibrary('offscreen'); assert.equal(calls.length, 2); search.state.query = '';

let finishOld, finishNew;
waits.push(() => new Promise(resolve => { finishOld = resolve; }), () => new Promise(resolve => { finishNew = resolve; }));
const old = context.loadHomeLibrary('first', true); cache.cancel();
const current = context.loadHomeLibrary('first', true);
await old; assert.equal(media.loading.first, true, 'Old cleanup must not clear a new request loading state');
finishOld({list: [{guid: 'late'}]}); finishNew({list: [{guid: 'new'}]}); await current;
assert.equal(media.info.first.list[0].guid, 'new'); assert.equal(media.loading.first, false);
let finishForeign;
waits.push(() => new Promise(resolve => { finishForeign = resolve; }));
const departing = context.loadHomeLibrary('first', true);
context.initializedAccount = null; cache.clear(); media.info = {}; media.loading = {};
await departing; finishForeign({list: [{guid: 'foreign'}]}); await new Promise(setImmediate);
assert.equal(Object.keys(media.info).length, 0); assert.equal(Object.keys(media.loading).length, 0);
console.log('PASS: actual App initialization and visible loader, finite pages, cache, partial errors, route/search gating, loading ownership and account departure');

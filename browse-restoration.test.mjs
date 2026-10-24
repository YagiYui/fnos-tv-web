import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {parse, compileScript} from 'vue/compiler-sfc';
import {BrowseSnapshots} from './src/browse-snapshots.js';
import {imageLoading, rememberImage, imageRetryUrl} from './src/image-loading.js';
import {mediaDetailTitle, continuePlaybackRoute} from './src/views/Play/player-presentation.js';

// Compile the shipped image component: source is present on its very first render.
const {descriptor} = parse(fs.readFileSync(new URL('./src/components/MediaImage.vue', import.meta.url), 'utf8'));
let compiled = compileScript(descriptor, {id: 'image-test', inlineTemplate: true}).content;
const bindings = {};
compiled = compiled.replace(/import \{([^}]+)\} from "vue"/g, (_, names) => {
  for (const item of names.split(',')) { const [name, alias = name] = item.trim().split(/\s+as\s+/); bindings[alias] = Vue[name]; }
  return '';
}).replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =');
const ctx = vm.createContext({...Vue, ...bindings, onBeforeUnmount() {}, imageLoading, rememberImage, imageRetryUrl}); vm.runInContext(compiled, ctx);
function renderImage(src, loading = 'lazy') { return ctx.component.setup({src, alt: 'poster', loading})({}, []); }
let vnode = renderImage('/poster.webp');
assert.equal(vnode.props.src, '/poster.webp'); assert.equal(vnode.props.loading, 'lazy');
const poster = {naturalWidth: 300, getAttribute: () => '/poster.webp'};
vnode.ref.r.value = poster;
vnode.props.onLoad({target: vnode.ref.r.value});
vnode = renderImage('/poster.webp');
assert.equal(vnode.props.src, '/poster.webp'); assert.equal(vnode.props.loading, 'eager');
assert.equal(renderImage('/hero.webp', 'eager').props.loading, 'eager');
rememberImage({target: {naturalWidth: 0, getAttribute: () => '/failed.webp'}});
assert.equal(imageLoading('/failed.webp'), 'lazy');
for (let index = 0; index < 512; index++) rememberImage({target: {naturalWidth: 1, getAttribute: () => '/p/' + index}});
assert.equal(imageLoading('/poster.webp'), 'lazy', 'Successful URL hints have bounded memory');

const snapshots = new BrowseSnapshots({limit: 2}); snapshots.setAccount('viewer');
const revision = snapshots.revision;
snapshots.save('viewer', 'home', {playList: [{guid: 'continuing'}], scrollY: 460});
snapshots.setAccount('other'); snapshots.setAccount('viewer');
snapshots.save('viewer', 'late', {info: {}}, revision);
assert.equal(snapshots.get('viewer', 'late'), null, 'Old account lifetime cannot write after A to B to A');
snapshots.save('viewer', 'home', {playList: [{guid: 'continuing'}], scrollY: 460});
let top = 0, finish, fail, calls = [];
const store = Vue.reactive({account: snapshots.account, revision: snapshots.revision,
  get: (...args) => snapshots.get(...args), save: (...args) => snapshots.save(...args)});
const COMMON = {userKey: 'viewer', requests: (...args) => {
  calls.push(args); return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
}};
const homeSource = fs.readFileSync(new URL('./src/views/Home.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
function mountHome() {
  let mounted, leave, unmounted;
  const errors = [], scope = Vue.effectScope();
  const context = vm.createContext({...Vue, AbortController, continuePlaybackRoute,
    useBrowseSnapshots: () => store,
    inject: (key, fallback) => key === 'pageScroll' ? {getTop: () => top, scrollTo: value => { top = value; }} : fallback,
    useMediaSearch: () => ({state: {query: '', scrollY: 0}, cancel() {}}), useMediaDbData: () => ({list: []}),
    getCurrentInstance: () => ({appContext: {config: {globalProperties: {$COMMON: COMMON}}}}),
    useMessage: () => ({error: error => errors.push(error)}), NIcon: {},
    window: {innerWidth: 1200, addEventListener() {}, removeEventListener() {}},
    document: {addEventListener() {}, removeEventListener() {}},
    onMounted: cb => { mounted = cb; }, onBeforeRouteLeave: cb => { leave = cb; }, onUnmounted: cb => { unmounted = cb; }});
  scope.run(() => vm.runInContext(homeSource + ';globalThis.home={playList,GetPlayList};', context));
  return {home: context.home, errors, mounted: () => mounted(), leave: () => leave(), unmount: () => { unmounted(); scope.stop(); }};
}
let view = mountHome(); assert.equal(view.home.playList.value[0].guid, 'continuing');
let pending = view.mounted(); await Vue.nextTick(); await new Promise(setImmediate);
assert.equal(top, 460); assert.equal(view.home.playList.value[0].guid, 'continuing');
fail(new Error('offline')); await pending;
assert.equal(view.home.playList.value[0].guid, 'continuing'); assert.deepEqual(view.errors, ['offline']);
pending = view.home.GetPlayList(); finish([]); await pending;
assert.equal(view.home.playList.value.length, 0, 'Successful empty server response replaces cached content');
pending = view.home.GetPlayList(); view.leave(); view.unmount();
assert.equal(calls.at(-1)[4].signal.aborted, true);
finish([{guid: 'late'}]); await pending;
assert.equal(snapshots.get('viewer', 'home').playList.length, 0);
view = mountHome(); snapshots.setAccount('other'); COMMON.userKey = 'other'; store.account = 'other'; store.revision = snapshots.revision;
assert.equal(view.home.playList.value, null, 'Active old-account content is removed synchronously');
view.unmount();
// Login can finish after Home mounted. It must bind the new lifetime and fetch without a refresh.
snapshots.setAccount('');store.account='';store.revision=snapshots.revision;delete COMMON.userKey;
view=mountHome();const beforeLogin=calls.length;await view.mounted();assert.equal(calls.length,beforeLogin);
COMMON.userKey='first-login';snapshots.setAccount('first-login');store.account='first-login';store.revision=snapshots.revision;
assert.equal(calls.length,beforeLogin+1);finish([{guid:'first-login-record'}]);await new Promise(setImmediate);
assert.equal(view.home.playList.value[0].guid,'first-login-record','Account readiness updates the already mounted Home');
view.unmount();snapshots.setAccount('other');
for (let index = 0; index < 3; index++) snapshots.save('other', 'detail-' + index, {info: {guid: index}});
assert.equal(snapshots.entries.size, 2); assert.equal(snapshots.get('viewer', 'detail-2'), null);
console.log('PASS: shipped image renders direct source, warm eager/cold lazy and bounded hints; actual Home restores before network, retains on failure, clears on empty success, aborts stale replies and isolates account lifetimes');

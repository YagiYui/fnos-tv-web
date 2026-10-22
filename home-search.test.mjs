import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, computed, watch, reactive, nextTick, h, effectScope} from 'vue';
import {MediaSearch, createSearchState, groupSearchResults, searchResultRoute} from './src/media-search.js';

const engine = new MediaSearch({state: reactive(createSearchState())});
engine.setAccount('fixture-viewer');
const store = {state: engine.state, submit: (...args) => engine.submit(...args), cancel: () => engine.cancel(),
  clear: () => engine.clear(), clearHistory: () => engine.clearHistory(), showMore: () => engine.showMore()};
const items = [{guid: 'outside-home', type: 'Movie', title: '首页没有加载的影片'}];
const calls = [];
const COMMON = {requests: async (method, uri, ...args) => {
  calls.push(uri);
  return uri === '/api/v1/play/list' ? [] : items;
}};
let top = 0;
const source = fs.readFileSync(new URL('./src/views/Home.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
function mountHome() {
  let mounted, leave, unmounted;
  const scope = effectScope();
  const context = vm.createContext({ref, computed, watch, nextTick, h, RouterLink: {}, groupSearchResults, searchResultRoute,
    inject: () => ({getTop: () => top, scrollTo: value => { top = value; }}),
    useMediaSearch: () => store, useMediaDbData: () => ({list: [], info: {}, errors: {}}),
    getCurrentInstance: () => ({appContext: {config: {globalProperties: {$COMMON: COMMON}}}}),
    useMessage: () => ({error: value => { throw new Error(value); }}), NIcon: {},
    window: {innerWidth: 1200, addEventListener() {}, removeEventListener() {}},
    document: {addEventListener() {}, removeEventListener() {}},
    onMounted: cb => { mounted = cb; }, onBeforeRouteLeave: cb => { leave = cb; },
    onUnmounted: cb => { unmounted = cb; }});
  scope.run(() => vm.runInContext(source + ';globalThis.home={keyword,submitSearch,clearSearch,searchHistory,searchGroups};', context));
  return {home: context.home, mounted: () => mounted(), leave: () => leave(), unmount: () => { unmounted(); scope.stop(); }};
}
let view = mountHome();
await view.mounted();
view.home.keyword.value = '输入法尚未确认';
await view.home.submitSearch({isComposing: true}); assert.equal(calls.length, 1);
view.home.keyword.value = '示例搜索'; await view.home.submitSearch();
assert.equal(calls.at(-1), '/api/v1/search/list?q=' + encodeURIComponent('示例搜索'));
assert.equal(view.home.searchGroups.value[0].items[0].guid, 'outside-home');
top = 475; view.leave(); view.unmount();
top = 0; view = mountHome(); await view.mounted();
assert.equal(view.home.keyword.value, '示例搜索'); assert.equal(top, 475);
assert.equal(calls.filter(uri => uri.startsWith('/api/v1/search/')).length, 1, 'Back navigation reuses memory results');
view.home.keyword.value = ''; await nextTick();
assert.equal(engine.state.query, ''); assert.equal(engine.state.items.length, 0); assert.equal(top, 0);
await view.home.searchHistory('示例搜索'); assert.equal(engine.state.query, '示例搜索');
engine.setAccount('another-viewer'); await nextTick();
assert.equal(view.home.keyword.value, ''); assert.equal(engine.state.history.length, 0);
view.unmount();
console.log('PASS: actual Home handlers, IME submit guard, server search, clearing, history, account reset and content-container position restoration');

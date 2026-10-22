import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref, computed, nextTick, watch, effectScope} from 'vue';

const app = fs.readFileSync(new URL('./src/App.vue', import.meta.url), 'utf8');
const removed = [], messages = [], apiCalls = [], timers = [];
let searchAccount = 'fixture-viewer', cacheClears = 0, historyClears = 0, reloads = 0;
let versionResult = {version: '0.9.8'};
const COMMON = {userKey: 'fixture-viewer', ShowMsg: text => messages.push(text),
  requests: async (...args) => { apiCalls.push(args); return versionResult; }};
const media = {info: {library: {}}, errors: {library: 'error'}, list: [{guid: 'library'}]};
const context = vm.createContext({COMMON, MediaDbData: media, data: ref(media.list),
  UserInfo: ref({username: '示例用户'}), serviceVersion: ref(''),
  mediaSearch: {setAccount: value => { searchAccount = value; }, clearHistory: () => { historyClears++; }},
  libraryViews: {setAccount: value => { assert.equal(value, ''); }}, homeLoads: new Map(),
  catalogCache: {clear: () => { cacheClears++; }}, VueCookies: {remove: name => removed.push(name)},
  setTimeout: callback => { timers.push(callback); }, location: {reload: () => { reloads++; }}});
const handlers = app.slice(app.indexOf('async function getServiceVersion()'), app.indexOf('async function GetMediaDbList()')) +
  app.slice(app.indexOf('function handleSelect('), app.indexOf('async function runFunByPath('));
vm.runInContext(handlers, context);
await context.getServiceVersion(); assert.equal(context.serviceVersion.value, '0.9.8');
assert.deepEqual(apiCalls[0], ['GET', '/api/v1/sys/version']);
versionResult = {version: null}; await context.getServiceVersion(); assert.equal(context.serviceVersion.value, '');
context.clearAccountHistory(); assert.equal(historyClears, 1); assert.equal(cacheClears, 0);
context.handleSelect('unrecognized'); assert.equal(removed.length, 0);
context.handleSelect('out');
assert.deepEqual(removed, ['authorization', 'Trim-MC-token']);
assert.equal(searchAccount, ''); assert.equal(cacheClears, 1);
assert.equal(Object.keys(media.info).length, 0); assert.equal(media.list.length, 0);
assert.equal(context.data.value.length, 0); assert.equal(Object.keys(context.UserInfo.value).length, 0);
assert.equal(COMMON.userKey, undefined); assert.equal(timers.length, 1);
timers[0](); assert.equal(reloads, 1);

const component = fs.readFileSync(new URL('./src/components/AccountMenu.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '');
const emitted = [];
let cardFocus = 0, triggerFocus = 0;
const menuContext = vm.createContext({ref, computed, nextTick, watch,
  defineProps: () => ({username: '  示例用户  '}), defineEmits: () => (...args) => emitted.push(args)});
const scope = effectScope();
scope.run(() => vm.runInContext(component + ';globalThis.menu={showMenu,triggerButton,card,displayName,initial,closeMenu,logout};', menuContext));
const menu = menuContext.menu;
menu.card.value = {focus: () => { cardFocus++; }};
menu.triggerButton.value = {$el: {focus: () => { triggerFocus++; }}};
menu.showMenu.value = true; await nextTick(); await new Promise(setImmediate);
assert.equal(cardFocus, 1); assert.equal(menu.displayName.value, '示例用户');
await menu.closeMenu(); assert.equal(menu.showMenu.value, false); assert.equal(triggerFocus, 1);
menu.showMenu.value = true; menu.logout();
assert.equal(menu.showMenu.value, false); assert.deepEqual(emitted, [['logout']]);
scope.stop();
console.log('PASS: actual account actions, account-scoped history, logout credential and media cleanup, public version parsing, menu focus and Escape close');

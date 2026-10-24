import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {parse, compileScript} from 'vue/compiler-sfc';
import {imageLoading, rememberImage, imageRetryUrl} from './src/image-loading.js';

// Mount the shipped component with Vue's renderer, controlling only host image events and time.
const {descriptor} = parse(fs.readFileSync(new URL('./src/components/MediaImage.vue', import.meta.url), 'utf8'));
let compiled = compileScript(descriptor, {id: 'image-retry-test', inlineTemplate: true}).content;
const bindings = {};
compiled = compiled.replace(/import \{([^}]+)\} from ["']vue["'];?/g, (_, names) => {
  for (const item of names.split(',')) { const [name, alias = name] = item.trim().split(/\s+as\s+/); bindings[alias] = Vue[name]; }
  return '';
}).replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =');
let id = 0;
const timers = new Map();
const ctx = vm.createContext({...bindings, imageLoading, rememberImage, imageRetryUrl,
  setTimeout: (run, delay) => { timers.set(++id, {run, delay}); return id; },
  clearTimeout: timer => timers.delete(timer)});
vm.runInContext(compiled, ctx);
const renderer = Vue.createRenderer({
  createElement: type => Vue.markRaw({type, props: {}, naturalWidth: 0, getAttribute(name) { return this.props[name]; }}),
  patchProp: (node, key, old, value) => { node.props[key] = value; },
  insert: (node, parent) => { parent.child = node; node.parent = parent; },
  remove: node => { if (node.parent?.child === node) node.parent.child = null; },
  parentNode: node => node.parent, nextSibling: () => null,
  createComment: text => ({text}), createText: text => ({text}), setText() {}, setElementText() {}
});
function mount(src) {
  const props = Vue.reactive({src, alt: '海报', loading: 'lazy'}), root = {};
  const app = renderer.createApp({render: () => Vue.h(ctx.component, props)}); app.mount(root);
  return {props, image: () => root.child, stop: () => app.unmount()};
}
async function tick(expectedDelay) {
  assert.equal(timers.size, 1);
  const [timer, {run, delay}] = timers.entries().next().value;
  assert.equal(delay, expectedDelay); timers.delete(timer); run(); await Vue.nextTick();
}
const original = '/fnos/v/api/v1/sys/img/example.webp?w=300#poster';
let view = mount(original), image = view.image();
assert.equal(image.props.src, original); assert.equal(image.props.loading, 'lazy');
image.props.onError({target: image}); image.props.onError({target: image});
assert.equal(timers.size, 1, 'Duplicate error events schedule one retry');
await tick(250);
assert.notEqual(view.image(), image, 'Failed image is replaced so a new request can start');
assert.equal(view.image().props.src, '/fnos/v/api/v1/sys/img/example.webp?w=300&__fnos_image_retry=1#poster');
image.props.onError({target: image}); assert.equal(timers.size, 0, 'Removed image events are ignored');
image = view.image(); image.naturalWidth = 300; image.props.onLoad({target: image});
assert.equal(imageLoading(original), 'eager', 'Retry success warms the original URL for return navigation');
assert.equal(timers.size, 0); view.stop();

view = mount('/fnos/v/api/v1/sys/img/missing.webp');
for (const delay of [250, 500, 1000, 1500, 2500]) {
  image = view.image(); image.props.onError({target: image}); await tick(delay);
}
image = view.image(); image.props.onError({target: image});
assert.equal(timers.size, 0, 'Permanent errors stop after five retries');
assert.equal(image.props.role, 'button');
let prevented = false;
image.props.onClick({type: 'click', preventDefault: () => { prevented = true; }, stopPropagation() {}}); await Vue.nextTick();
assert.ok(prevented, 'Retry does not open the movie detail');
assert.ok(view.image().props.src.endsWith('__fnos_image_retry=6'), 'Manual retry gets a fresh URL after automatic retries exhaust');
view.image().props.onError({target: view.image()}); await tick(250);
view.stop();

view = mount('/fnos/v/api/v1/sys/img/old.webp'); image = view.image();
image.props.onError({target: image});
view.props.src = '/fnos/v/api/v1/sys/img/new.webp'; await Vue.nextTick();
assert.equal(timers.size, 0, 'Changing media cancels the previous retry');
assert.equal(view.image().props.src, view.props.src);
image.props.onError({target: image}); assert.equal(timers.size, 0);
image = view.image(); image.props.onError({target: image});
image.naturalWidth = 300; image.props.onLoad({target: image});
assert.equal(timers.size, 0, 'Success cancels an already scheduled retry');
image.props.onError({target: image}); view.stop();
assert.equal(timers.size, 0, 'Unmount cancels retries');
image.props.onError({target: image}); assert.equal(timers.size, 0);

const custom = 'https://images.example.invalid/poster.webp?signature=example';
view = mount(custom); image = view.image(); image.props.onError({target: image}); await tick(250);
assert.equal(view.image().props.src, custom, 'Custom image URLs and their signatures remain unchanged');
assert.notEqual(view.image(), image, 'Custom URL retry also creates a fresh image element'); view.stop();
assert.equal(timers.size, 0);
console.log('PASS: actual MediaImage retries transient failures, stops at its bound, cancels stale events/timers, preserves URL parameters and warm original URL hints');

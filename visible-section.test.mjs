import assert from 'node:assert/strict';
import {observeSection} from './src/visible-section.js';
import {CatalogCache} from './src/catalog-cache.js';

let callback, observed, disconnected = 0, shown = 0;
class Observer {
  constructor(cb, options) { callback = cb; assert.equal(options.rootMargin, '160px 0px'); }
  observe(element) { observed = element; }
  disconnect() { disconnected++; }
}
const element = {};
const stop = observeSection(element, () => { shown++; }, Observer);
assert.equal(observed, element);
callback([{target: element, isIntersecting: false}]); assert.equal(shown, 0);
callback([{target: {}, isIntersecting: true}]); assert.equal(shown, 0);
callback([{target: element, isIntersecting: true}]); assert.equal(shown, 1);
callback([{target: element, isIntersecting: true}]); assert.equal(shown, 1);
stop(); assert.ok(disconnected > 0);
const stopBeforeVisible = observeSection(element, () => { shown++; }, Observer);
stopBeforeVisible(); callback([{target: element, isIntersecting: true}]); assert.equal(shown, 1);
observeSection(element, () => { shown++; }, null); assert.equal(shown, 2);

const cache = new CatalogCache();
let active = 0, peak = 0, calls = 0;
const finishes = [], received = [];
const options = {account: 'viewer', sortColumn: 'create_time', sortType: 'DESC',
  request: (payload, signal) => new Promise(resolve => {
    calls++; active++; peak = Math.max(peak, active);
    finishes.push(() => { active--; resolve({list: [{guid: payload.ancestor_guid}]}); });
  }), onData: id => received.push(id), onError: error => { throw error; }};
const libraries = Array.from({length: 7}, (_, i) => ({guid: String(i), category: 'Movie'}));
const loads = libraries.map(library => cache.load([library], options));
loads.push(cache.load([libraries[0]], options));
assert.equal(calls, 3, 'Separate visibility notifications share one concurrency limit');
while (finishes.length) { finishes.shift()(); await new Promise(setImmediate); }
await Promise.all(loads);
assert.equal(peak, 3); assert.equal(calls, 7, 'An in-flight library is requested once');
assert.equal(received.length, 8);
cache.cancel(); await cache.load([libraries[0]], options); assert.equal(calls, 7, 'Cancel retains successful short-lived data');

const canceled = new CatalogCache({concurrency: 1});
let resolveOld, oldSignal, canceledCalls = 0, canceledWrites = 0;
const waiting = canceled.load(libraries, {...options, request: (_, signal) => {
  canceledCalls++; oldSignal = signal; return new Promise(resolve => { resolveOld = resolve; });
}, onData: () => { canceledWrites++; }});
canceled.cancel(); await waiting;
assert.equal(oldSignal.aborted, true); assert.equal(canceledCalls, 1);
resolveOld({list: [{guid: 'late'}]}); await new Promise(setImmediate);
assert.equal(canceledWrites, 0); assert.equal(canceled.entries.size, 0);
console.log('PASS: offscreen suppression, single visibility trigger, disposal, fallback, shared concurrency, in-flight deduplication and queued/stale cancellation');

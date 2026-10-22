import assert from 'node:assert/strict';
import {CatalogCache, HOME_PAGE_SIZE} from './src/catalog-cache.js';
const libraries = Array.from({length: 8}, (_, i) => ({guid: String(i), category: 'Movie'}));
let active = 0, peak = 0, calls = 0, clock = 0;
const received = [], errors = [];
const cache = new CatalogCache({now: () => clock});
const options = {account: 'viewer-one', sortColumn: 'create_time', sortType: 'DESC',
  request: async payload => {
    calls++; active++; peak = Math.max(peak, active);
    assert.equal(payload.page_size, HOME_PAGE_SIZE); assert.equal(payload.page, 1);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (payload.ancestor_guid === '3') throw new Error('one library failed');
    return {list: [{guid: payload.ancestor_guid}]};
  }, onData: (...data) => received.push(data), onError: (...data) => errors.push(data)};
await cache.load(libraries, options);
assert.equal(peak, 3); assert.equal(received.length, 7); assert.equal(errors.length, 1);
await cache.load(libraries, options); assert.equal(calls, 9, 'Only failed entry retries within TTL');
clock = 60001; await cache.load(libraries, options); assert.equal(calls, 17);
await cache.load([libraries[0]], {...options, account: 'viewer-two'}); assert.equal(calls, 18);
let finish; const old = cache.load([libraries[0]], {...options, force: true,
  request: (_, signal) => {assert.equal(signal.aborted, false); return new Promise(resolve => finish = resolve);}});
const before = received.length; cache.clear(); finish({list: [{guid: 'stale'}]}); await old;
assert.equal(received.length, before); assert.equal(cache.entries.size, 0);
console.log('PASS: bounded pages/concurrency, account cache, expiry, partial failure and stale cancellation');

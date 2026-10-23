import assert from 'node:assert/strict';
import {MediaActions, mediaFlag, listFavoriteMedia} from './src/media-actions.js';
import {loadCatalogFilterOptions} from './src/catalog-filters.js';

const calls = [], changes = [];
let handler = async () => undefined;
const requests = (...args) => { calls.push(args); return handler(...args); };
const actions = new MediaActions({requests, onInvalidate: event => changes.push(event)});
await assert.rejects(actions.update({id: 'movie', kind: 'favorite', enabled: true}), /请先登录/);
actions.setAccount('viewer');
assert.equal(mediaFlag({}, 'watched'), null); assert.equal(mediaFlag({watched: '0'}, 'watched'), false);
assert.equal(mediaFlag({is_favorite: 1}, 'favorite'), true);
let state = 0;
handler = async (method, path, auth, body) => {
  if (method === 'GET') return {guid: 'movie', is_favorite: state, watched: state};
  state = method === 'DELETE' ? 0 : 1;
};
let result = await actions.update({id: 'movie', kind: 'favorite', enabled: true});
assert.equal(result.saved, true); assert.equal(result.confirmed, true);
assert.deepEqual(calls[0].slice(0, 4), ['PUT', '/api/v1/item/favorite', true, {item_guid: 'movie'}]);
assert.equal(changes[0].account, 'viewer'); assert.equal(calls[1][0], 'GET');
await actions.update({id: 'movie', kind: 'favorite', enabled: false});
assert.deepEqual(calls[2].slice(0, 4), ['DELETE', '/api/v1/item/favorite', true, {item_guid: 'movie'}]);
await actions.update({id: 'movie', kind: 'watched', enabled: true});
assert.deepEqual(calls[4].slice(0, 4), ['POST', '/api/v1/item/watched', true, {item_guid: 'movie'}]);
await actions.update({id: 'movie', kind: 'watched', enabled: false});
assert.equal(calls[6][0], 'DELETE'); assert.equal(calls[6][1], '/api/v1/item/watched');

let finish;
handler = () => new Promise(resolve => { finish = resolve; });
let start = calls.length;
const first = actions.update({id: 'movie', kind: 'favorite', enabled: true, refresh: false});
const repeated = actions.update({id: 'movie', kind: 'favorite', enabled: true, refresh: false});
assert.equal(first, repeated, 'Identical clicks share one in-flight write');
await assert.rejects(actions.update({id: 'movie', kind: 'favorite', enabled: false}), /正在更新/);
await Promise.resolve(); assert.equal(calls.length, start + 1);
finish(); await first;
// An accepted write must not be reported as failed just because refresh failed.
handler = async method => { if (method === 'GET') throw new Error('offline'); };
result = await actions.update({id: 'movie', kind: 'favorite', enabled: true});
assert.equal(result.saved, true); assert.equal(result.item, null); assert.match(result.warning, /已保存/);
// A server/business rejection never becomes optimistic success. It is not automatically retried.
start = calls.length;
handler = async method => { if (method !== 'GET') throw new Error('official refused'); return {guid: 'movie', watched: 0}; };
result = await actions.update({id: 'movie', kind: 'watched', enabled: true});
assert.equal(result.saved, false); assert.equal(result.confirmed, false); assert.equal(result.error, 'official refused');
assert.equal(calls.slice(start).filter(call => call[0] !== 'GET').length, 1);
// Callback failure cannot turn server success into a repeated mutation.
const brokenCache = new MediaActions({requests: async method => method === 'GET' ? {guid: 'movie', watched: 1} : undefined,
  onInvalidate: () => { throw new Error('cache failure'); }});
brokenCache.setAccount('viewer'); result = await brokenCache.update({id: 'movie', kind: 'watched', enabled: true});
assert.equal(result.saved, true); assert.match(result.warning, /缓存/);

handler = () => new Promise(resolve => { finish = resolve; });
const old = actions.update({id: 'movie', kind: 'favorite', enabled: true}); await Promise.resolve();
const signal = calls.at(-1)[4].signal, beforeAccountChange = changes.length;
actions.setAccount('other'); actions.setAccount('viewer');
assert.equal(signal.aborted, true);
finish(); result = await old;
assert.equal(result.superseded, true); assert.equal(changes.length, beforeAccountChange);
assert.equal(actions.pending.size, 0);
start = calls.length;
const notStarted = actions.update({id: 'movie', kind: 'favorite', enabled: true});
actions.setAccount('other');
assert.equal((await notStarted).superseded, true); assert.equal(calls.length, start);
actions.setAccount('viewer');

// Bulk operations have two workers, exact per-episode results, no write retries, and stop new starts.
const deferred = [], ids = ['one', 'two', 'three', 'four']; let active = 0, maximum = 0;
handler = (method, path, auth, body) => new Promise((resolve, reject) => {
  maximum = Math.max(maximum, ++active);
  deferred.push({id: body.item_guid, finish: error => { active--; error ? reject(new Error(error)) : resolve(); }});
});
let batch = actions.updateWatchedBatch([...ids, 'one'], true);
await new Promise(setImmediate); assert.equal(deferred.length, 2);
deferred[0].finish(); await new Promise(setImmediate); assert.equal(deferred.length, 3);
deferred[1].finish('episode refused'); await new Promise(setImmediate); assert.equal(deferred.length, 4);
deferred[2].finish(); deferred[3].finish(); result = await batch;
assert.equal(maximum, 2); assert.deepEqual(result.saved.sort(), ['four', 'one', 'three']);
assert.deepEqual(result.failed, [{id: 'two', error: 'episode refused'}]); assert.deepEqual(result.skipped, []);
assert.equal(result.stopped, false);
deferred.length = 0; batch = actions.updateWatchedBatch(ids, false);
await new Promise(setImmediate); actions.stopBatch();
deferred[0].finish(); deferred[1].finish(); result = await batch;
assert.equal(deferred.length, 2); assert.equal(result.saved.length, 2);
assert.deepEqual(result.skipped, ['three', 'four']); assert.equal(result.stopped, true);
await assert.rejects(actions.updateWatchedBatch(['one', '../bad'], true), /分集列表无效/);
assert.equal(actions.pending.size, 0);
// Account changes stop the old queue; the next account can start work immediately.
deferred.length = 0; batch = actions.updateWatchedBatch(ids, true);
await new Promise(setImmediate); const oldFinishes = deferred.slice();
actions.setAccount('next-viewer');
handler = async () => undefined;
const nextBatch = await actions.updateWatchedBatch(['new-item'], true);
assert.deepEqual(nextBatch.saved, ['new-item']);
oldFinishes.forEach(entry => entry.finish());
const oldBatch = await batch;
assert.equal(oldBatch.superseded, true); assert.equal(oldBatch.stopped, true);
assert.deepEqual(oldBatch.skipped, ['three', 'four']);

handler = async (method, path, auth, body) => ({total: 1, list: [{guid: 'favorite-movie'}]});
const favorites = await listFavoriteMedia(requests, {filters: {watched: '0'}, page: 2});
assert.equal(favorites.total, 1);
const favoriteCall = calls.at(-1);
assert.equal(favoriteCall[0], 'POST'); assert.equal(favoriteCall[1], '/api/v1/favorite/list');
assert.equal(favoriteCall[3].page, 2); assert.equal(favoriteCall[3].tags.watched, '0');
assert.equal(Object.hasOwn(favoriteCall[3], 'isFavorite'), false);
await assert.rejects(listFavoriteMedia(requests, {page: -1}), /分页参数/);
await assert.rejects(listFavoriteMedia(async () => []), /数据无效/);
const metadataCalls = [];
await loadCatalogFilterOptions(async (...args) => {
  metadataCalls.push(args); return args[1].includes('/tag/genres') ? [] : {};
}, null, '', undefined, {favorites: true});
const params = new URLSearchParams(metadataCalls[0][1].split('?')[1]);
assert.equal(params.get('is_favorite'), '1'); assert.equal(params.has('ancestor_guid'), false);
console.log('PASS: official mutation methods/bodies, authoritative refresh, duplicate/busy guards, uncertain failures without retries, account lifetimes, bounded bulk work and cancellation, favorites paging and metadata scope');

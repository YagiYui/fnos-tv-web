import assert from 'node:assert/strict';
import {MediaSearch, searchMedia, groupSearchResults, searchResultRoute} from './src/media-search.js';

const records = [{guid: 'example-movie', type: 'Movie', title: '服务端匹配的不同片名', watched: 1},
  {guid: 'example-tv', type: 'TV', title: '示例剧集'}];
let calls = 0;
const query = '中文 &?+# /';
const request = async (method, uri, login, body, options) => {
  calls++;
  assert.equal(method, 'GET'); assert.equal(login, true); assert.deepEqual(body, {});
  const url = new URL(uri, 'https://example.invalid');
  assert.equal(url.pathname, '/api/v1/search/list');
  assert.deepEqual([...url.searchParams], [['q', query]]);
  assert.ok(options.signal instanceof AbortSignal);
  return records;
};
const storageData = new Map();
const storage = {getItem: key => storageData.get(key), setItem: (key, value) => storageData.set(key, value),
  removeItem: key => storageData.delete(key)};
const session = new MediaSearch({storage});
session.setAccount('viewer-one');
await session.submit(request, '  ' + query + '  ');
assert.equal(calls, 1); assert.equal(session.state.status, 'success');
assert.equal(session.state.items.length, 2, 'Do not apply a second title filter');
assert.deepEqual(session.state.history, [query]);

const deferred = [];
const delayed = (...args) => new Promise((resolve, reject) => deferred.push({resolve, reject, signal: args[4].signal}));
const old = session.submit(delayed, '旧查询');
const latest = session.submit(delayed, '新查询');
assert.equal(deferred[0].signal.aborted, true);
deferred[1].resolve(records); await latest;
deferred[0].resolve([{guid: 'stale', type: 'Movie'}]); await old;
assert.equal(session.state.query, '新查询'); assert.deepEqual(session.state.items, records);
assert.deepEqual(session.state.history, ['新查询', query]);

const pending = session.submit(delayed, '即将清空'); session.clear();
deferred[2].reject(new Error('aborted request failed late')); await pending;
assert.equal(session.state.status, 'idle'); assert.equal(session.state.error, '');
assert.equal(session.state.items.length, 0); assert.equal(session.state.query, '');
await session.submit(request, '   '); assert.equal(calls, 1);

await session.submit(async () => { throw new Error('登录已失效'); }, '鉴权失败');
assert.equal(session.state.status, 'error'); assert.equal(session.state.error, '登录已失效');
await session.submit(async () => ({list: records}), '错误结构');
assert.match(session.state.error, /格式异常/); assert.equal(session.state.items.length, 0);
await assert.rejects(searchMedia(async () => [{type: 'Movie'}], '示例'), /格式异常/);
await session.submit(async () => [], '空结果');
assert.equal(session.state.status, 'success'); assert.equal(session.state.items.length, 0);

const changing = session.submit(delayed, '切换账户');
session.setAccount('viewer-two');
deferred[3].resolve(records); await changing;
assert.equal(session.state.query, ''); assert.deepEqual(session.state.history, []);
session.setAccount('viewer-one'); assert.equal(session.state.history[0], '空结果');
session.clearHistory(); assert.equal(storageData.size, 0);
session.setAccount(''); await session.submit(request, query);
assert.equal(calls, 1); assert.equal(session.state.status, 'error');

const grouped = groupSearchResults([...records, ...Array.from({length: 30}, (_, i) => ({guid: `movie-${i}`, type: 'Movie'})),
  {guid: 'unknown', type: 'NewType'}]);
assert.deepEqual(grouped.map(group => [group.key, group.total, group.items.length]),
  [['Movie', 31, 21], ['TV', 1, 1], ['other', 1, 1]]);
assert.equal(searchResultRoute(grouped[2].items[0]), null);
assert.deepEqual(searchResultRoute(records[1]), {path: '/video', query: {guid: 'example-tv', gallery_type: 'TV'}});
console.log('PASS: official search contract, encoded query, authoritative matches, cancellation, stale responses, errors, empty results, account isolation and display batches');

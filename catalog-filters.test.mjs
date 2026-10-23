import assert from 'node:assert/strict';
import {catalogTags, emptyCatalogFilters, normalizeCatalogFilters, catalogTypeOptions, catalogFilterCount, loadCatalogFilterOptions} from './src/catalog-filters.js';

assert.deepEqual(catalogTags(emptyCatalogFilters()), {type: ['Movie', 'TV', 'Directory', 'Video']});
assert.deepEqual(catalogTags({type: 'Movie', genres: 7, decade: '2010s', watched: '0'}),
  {type: ['Movie'], genres: 7, decade: '2010s', watched: '0'});
assert.deepEqual(catalogTags({type: 'TV', watched: '1'}), {type: ['TV'], watched: '1'});
assert.equal(catalogFilterCount({watched: '0'}), 1, 'Unwatched must not be discarded as falsy');
assert.equal(catalogFilterCount({type: 'Movie', genres: 7, decade: '2010s', watched: '1'}), 4);
assert.deepEqual(normalizeCatalogFilters({type: 'invalid', genres: 'NaN', decade: '1900..2026', watched: false}), emptyCatalogFilters());
assert.equal(normalizeCatalogFilters({genres: 0}).genres, 0);
assert.equal(catalogTypeOptions('Movie').length, 1); assert.equal(catalogTypeOptions('mixed').length, 2);
const calls = [], signal = new AbortController().signal;
const requests = async (...args) => {
  calls.push(args);
  return args[1].includes('/tag/list?') ? {genres: [7, 2, 7, 99, 'invalid'], decades: ['2010s', 'Others', 'bogus', '2010s']}
    : [{id: 7, value: '剧情'}, {id: 2, value: '喜剧'}];
};
const options = await loadCatalogFilterOptions(requests, 'library + &', 'Movie', signal);
const params = new URLSearchParams(calls[0][1].split('?')[1]);
assert.equal(params.get('ancestor_guid'), 'library + &'); assert.equal(params.get('is_favorite'), '0');
assert.equal(params.get('type'), 'Movie'); assert.equal(calls[0][4].signal, signal);
assert.equal(calls[1][1], '/api/v1/tag/genres?lan=zh-CN'); assert.equal(calls[1][2], true);
assert.deepEqual(options.genres, [{value: 7, label: '剧情'}, {value: 2, label: '喜剧'}]);
assert.deepEqual(options.decades.map(item => item.value), ['2010s', 'Others']);
assert.equal(options.warning, '');
const degraded = await loadCatalogFilterOptions(async (method, uri) => {
  if (uri.includes('/tag/genres')) throw new Error('names unavailable');
  return {genres: [7], decades: ['Recent']};
}, 'library', 'TV', signal);
assert.deepEqual(degraded.genres, []); assert.equal(degraded.decades[0].value, 'Recent');
assert.match(degraded.warning, /题材名称加载失败/);
await assert.rejects(loadCatalogFilterOptions(async () => { throw new Error('offline'); }, 'library', '', signal), /offline/);
await assert.rejects(loadCatalogFilterOptions(async () => [], 'library', '', signal), /筛选选项数据无效/);
console.log('PASS: official tag payloads, unwatched zero, genre scalars, decade allowlist, metadata URLs, label matching, partial failure and invalid response handling');

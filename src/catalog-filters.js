const types = [{value: 'Movie', label: '电影'}, {value: 'TV', label: '剧集'}];
const decades = {Recent: '近期', '2020s': '2020 年代', '2010s': '2010 年代', '2000s': '2000 年代',
  '1990s': '1990 年代', '1980s': '1980 年代', '1970s': '1970 年代', Others: '其他年代'};
export const watchedOptions = [{value: '0', label: '未看'}, {value: '1', label: '已看'}];
export function emptyCatalogFilters() { return {type: '', genres: null, decade: '', watched: ''}; }
export function normalizeCatalogFilters(value = {}) {
  const genre = value?.genres;
  return {type: types.some(item => item.value === value?.type) ? value.type : '',
    genres: genre !== null && genre !== '' && Number.isSafeInteger(Number(genre)) && Number(genre) >= 0 ? Number(genre) : null,
    decade: Object.hasOwn(decades, value?.decade) ? value.decade : '',
    watched: ['0', '1'].includes(value?.watched) ? value.watched : ''};
}
export function catalogTags(value) {
  const filters = normalizeCatalogFilters(value);
  const tags = {type: filters.type ? [filters.type] : ['Movie', 'TV', 'Directory', 'Video']};
  if (filters.genres !== null) tags.genres = filters.genres;
  if (filters.decade) tags.decade = filters.decade;
  if (filters.watched !== '') tags.watched = filters.watched;
  return tags;
}
export function catalogTypeOptions(category) { return types.filter(item => !['Movie', 'TV'].includes(category) || item.value === category); }
export function catalogFilterCount(value) {
  const filters = normalizeCatalogFilters(value);
  return Number(Boolean(filters.type)) + Number(filters.genres !== null) + Number(Boolean(filters.decade)) + Number(filters.watched !== '');
}
export function catalogFilterSummary(value, options = {}) {
  const filters = normalizeCatalogFilters(value);
  return [types.find(item => item.value === filters.type)?.label,
    filters.genres !== null ? options.genres?.find(item => item.value === filters.genres)?.label || `题材 #${filters.genres}` : '',
    decades[filters.decade], watchedOptions.find(item => item.value === filters.watched)?.label].filter(Boolean).join(' · ');
}
export async function loadCatalogFilterOptions(requests, guid, category, signal, {favorites = false} = {}) {
  const params = new URLSearchParams({is_favorite: favorites ? '1' : '0'});
  if (!favorites && guid) params.set('ancestor_guid', guid);
  if (['Movie', 'TV'].includes(category)) params.set('type', category);
  const results = await Promise.allSettled([
    requests('GET', '/api/v1/tag/list?' + params, true, {}, {signal}),
    requests('GET', '/api/v1/tag/genres?lan=zh-CN', true, {}, {signal})
  ]);
  if (results[0].status === 'rejected') throw results[0].reason;
  const available = results[0].value;
  if (!available || typeof available !== 'object' || Array.isArray(available)) throw new Error('筛选选项数据无效');
  const labels = new Map();
  const genreResult = results[1];
  if (genreResult.status === 'fulfilled' && Array.isArray(genreResult.value)) {
    for (const item of genreResult.value) {
      if (Number.isSafeInteger(Number(item.id)) && typeof item.value === 'string' && item.value.trim()) labels.set(Number(item.id), item.value);
    }
  }
  const genreIds = Array.isArray(available.genres) ? available.genres : [];
  const decadeIds = Array.isArray(available.decades) ? available.decades : [];
  return {genres: [...new Set(genreIds.filter(id => Number.isSafeInteger(Number(id))).map(Number))]
    .filter(id => labels.has(id)).map(id => ({value: id, label: labels.get(id)})),
    decades: [...new Set(decadeIds)].filter(value => Object.hasOwn(decades, value)).map(value => ({value, label: decades[value]})),
    warning: genreResult.status === 'rejected' || !Array.isArray(genreResult.value) ? '题材名称加载失败，可重试；其他筛选仍可使用' : ''};
}

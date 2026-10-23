export const SEARCH_BATCH_SIZE = 21;
const HISTORY_LIMIT = 10;

export function createSearchState() {
  return {query: '', items: [], status: 'idle', error: '', history: [], limit: SEARCH_BATCH_SIZE, scrollY: 0, stale: false};
}

// COMMON.requests unwraps the official {code, msg, data} envelope and rejects business errors.
export async function searchMedia(requests, query, signal) {
  const keyword = String(query ?? '').trim();
  if (!keyword) return [];
  const data = await requests('GET', '/api/v1/search/list?' + new URLSearchParams({q: keyword}),
    true, {}, {signal});
  if (!Array.isArray(data) || data.some(item => !item || typeof item.guid !== 'string' ||
      !item.guid || typeof item.type !== 'string')) {
    throw new Error('搜索结果格式异常，请重试');
  }
  // Matching is owned by the server; titles need not contain the query.
  return data;
}

export function groupSearchResults(items, limit = SEARCH_BATCH_SIZE) {
  return [
    {key: 'Movie', title: '电影', items: items.filter(item => item.type === 'Movie')},
    {key: 'TV', title: '剧集', items: items.filter(item => item.type === 'TV')},
    {key: 'other', title: '其他', items: items.filter(item => !['Movie', 'TV'].includes(item.type))}
  ].filter(group => group.items.length).map(group => ({...group,
    total: group.items.length, items: group.items.slice(0, limit)}));
}

export function searchResultRoute(item) {
  if (!['Movie', 'TV', 'season'].includes(item.type)) return null;
  return {path: '/video', query: {guid: item.guid, gallery_type: item.type}};
}

// Only the active account's results live in memory. No tokens or media records enter storage.
export class MediaSearch {
  constructor({state = createSearchState(), storage = null} = {}) {
    this.state = state;
    this.storage = storage;
    this.account = '';
    this.generation = 0;
    this.controller = null;
  }

  historyKey() { return 'fnos.search.history.' + encodeURIComponent(this.account); }

  setAccount(account) {
    const next = String(account ?? '');
    if (next === this.account) return;
    this.cancel();
    this.account = next;
    Object.assign(this.state, createSearchState());
    if (!next) return;
    try {
      const history = JSON.parse(this.storage?.getItem(this.historyKey()) || '[]');
      if (Array.isArray(history)) this.state.history = [...new Set(history
        .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].slice(0, HISTORY_LIMIT);
    } catch { /* A corrupt or unavailable history must not block search. */ }
  }

  saveHistory(query) {
    this.state.history = [query, ...this.state.history.filter(value => value !== query)].slice(0, HISTORY_LIMIT);
    try { this.storage?.setItem(this.historyKey(), JSON.stringify(this.state.history)); } catch { /* Optional. */ }
  }

  clearHistory() {
    this.state.history = [];
    try { this.storage?.removeItem(this.historyKey()); } catch { /* Optional. */ }
  }

  cancel() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.state.status === 'loading') this.state.status = 'idle';
  }

  clear() {
    this.cancel();
    Object.assign(this.state, createSearchState(), {history: this.state.history});
  }
  invalidate() { this.cancel(); this.state.stale = Boolean(this.state.query); }

  async submit(requests, query, {preserve = false} = {}) {
    const keyword = String(query ?? '').trim();
    if (preserve && keyword === this.state.query) { this.cancel(); this.state.error = ''; }
    else this.clear();
    if (!keyword) return;
    this.state.query = keyword;
    if (!this.account) {
      this.state.status = 'error';
      this.state.error = '请先登录';
      return;
    }
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.state.status = 'loading';
    try {
      const items = await searchMedia(requests, keyword, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      this.state.items = items;
      this.state.status = 'success';
      this.state.stale = false;
      this.saveHistory(keyword);
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.state.status = 'error';
      this.state.error = error?.message || '搜索失败，请重试';
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }

  showMore() { this.state.limit += SEARCH_BATCH_SIZE; }
}

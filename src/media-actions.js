import {catalogTags} from './catalog-filters.js';

const routes = {
  favorite: {add: 'PUT', remove: 'DELETE', path: '/api/v1/item/favorite', field: 'is_favorite'},
  watched: {add: 'POST', remove: 'DELETE', path: '/api/v1/item/watched', field: 'watched'}
};
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function mediaFlag(info, kind) {
  if (!Object.hasOwn(routes, kind)) return null;
  const value = info?.[routes[kind]?.field];
  return value === 1 || value === '1' ? true : value === 0 || value === '0' ? false : null;
}

// Uses COMMON.requests: business failures reject; a successful empty data body is valid.
export async function listFavoriteMedia(requests, {page = 1, pageSize = 48, sortColumn = 'create_time', sortType = 'DESC', filters = {}, signal} = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('收藏分页参数无效');
  if (!['create_time', 'sort_title', 'vote_average', 'release_date'].includes(sortColumn) || !['ASC', 'DESC'].includes(sortType)) throw new Error('收藏排序参数无效');
  const data = await requests('POST', '/api/v1/favorite/list', true, {page, page_size: pageSize,
    sort_column: sortColumn, sort_type: sortType, exclude_grouped_video: 1, tags: catalogTags(filters)}, {signal});
  if (!Array.isArray(data?.list)) throw new Error('收藏列表数据无效，请重试');
  return data;
}

// One active account; mutations are never automatically retried or persisted.
export class MediaActions {
  constructor({requests, onInvalidate = () => {}}) {
    this.requests = requests; this.onInvalidate = onInvalidate;
    this.account = ''; this.revision = 0; this.pending = new Map(); this.batch = null;
  }
  setAccount(account) {
    const next = String(account ?? '');
    if (next === this.account) return;
    this.account = next; this.revision++;
    this.stopBatch();
    this.batch = null;
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
  }
  update({id, kind, enabled, refresh = true}) {
    if (!validId(id) || !Object.hasOwn(routes, kind) || typeof enabled !== 'boolean' || typeof refresh !== 'boolean') return Promise.reject(new Error('媒体状态参数无效'));
    if (!this.account) return Promise.reject(new Error('请先登录'));
    const key = JSON.stringify([kind, id]);
    const existing = this.pending.get(key);
    if (existing) return existing.enabled === enabled && existing.refresh === refresh ? existing.promise : Promise.reject(new Error('该项正在更新，请稍后再试'));
    const entry = {id, kind, enabled, refresh, key, account: this.account, revision: this.revision, controller: new AbortController()};
    // Reserve the entry before invoking caller-provided request functions.
    entry.promise = Promise.resolve().then(() => this.run(entry));
    this.pending.set(key, entry);
    return entry.promise;
  }
  async run(entry) {
    const {id, kind, enabled, account, revision, controller} = entry;
    const current = () => this.account === account && this.revision === revision && !controller.signal.aborted;
    const result = {id, account, revision, saved: false, superseded: false, item: null, confirmed: null, error: '', warning: ''};
    try {
      if (!current()) return {...result, superseded: true};
      const route = routes[kind];
      try {
        await this.requests(enabled ? route.add : route.remove, route.path, true, {item_guid: id}, {signal: controller.signal});
        result.saved = true;
      } catch (error) { result.error = error?.message || '操作未确认，请刷新核对'; }
      if (!current()) return {...result, superseded: true};
      // Even a timed-out write may have reached the server. Invalidate, never infer rollback.
      try { await this.onInvalidate({account, revision, id, kind, enabled, saved: result.saved}); }
      catch { result.warning = '列表缓存更新失败，请刷新核对'; }
      if (!current()) return {...result, superseded: true};
      if (entry.refresh) {
        try {
          const info = await this.requests('GET', '/api/v1/item/' + id, true, {}, {signal: controller.signal});
          if (!current()) return {...result, superseded: true};
          if (!info || info.guid !== id) throw new Error('媒体状态数据无效');
          result.item = info;
          result.confirmed = mediaFlag(info, kind);
          if (result.saved && result.confirmed !== enabled) result.warning = '服务器当前状态与提交目标不一致，请核对最新信息';
        } catch {
          if (current()) result.warning = result.saved ? '操作已保存，最新状态读取失败，请刷新核对' : '最新状态读取失败，请刷新核对操作结果';
        }
      }
      return current() ? result : {...result, superseded: true};
    } finally {
      if (this.pending.get(entry.key) === entry) this.pending.delete(entry.key);
    }
  }
  stopBatch() { if (this.batch) this.batch.stopped = true; }
  async updateWatchedBatch(ids, enabled, {onProgress = () => {}} = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !validId(id)) || typeof enabled !== 'boolean') throw new Error('分集列表无效');
    if (!this.account) throw new Error('请先登录');
    if (this.batch) throw new Error('已有整季操作正在执行');
    const targets = [...new Set(ids)];
    const batch = this.batch = {stopped: false, account: this.account, revision: this.revision};
    const current = () => batch.account === this.account && batch.revision === this.revision;
    const result = {saved: [], failed: [], skipped: [], stopped: false};
    let index = 0;
    const worker = async () => {
      while (!batch.stopped && current() && index < targets.length) {
        const id = targets[index++];
        try {
          // One acknowledged write per episode. The caller refreshes the season once at the end.
          const update = await this.update({id, kind: 'watched', enabled, refresh: false});
          if (update.saved && !update.superseded) result.saved.push(id);
          else result.failed.push({id, error: update.error || '操作结果未确认，请刷新核对'});
        } catch (error) { result.failed.push({id, error: error?.message || '操作未确认'}); }
        if (current()) {
          try { onProgress({completed: result.saved.length + result.failed.length, total: targets.length,
            saved: result.saved.length, failed: result.failed.length}); } catch { /* Progress display cannot repeat a write. */ }
        }
      }
    };
    try {
      await Promise.all([worker(), worker()]);
      result.skipped = targets.slice(index);
      result.stopped = batch.stopped || !current();
      result.superseded = !current();
      return result;
    } finally { if (this.batch === batch) this.batch = null; }
  }
}

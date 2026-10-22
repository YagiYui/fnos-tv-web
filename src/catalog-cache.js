export const HOME_PAGE_SIZE = 21;

// Short-lived account-scoped memory cache. No credentials or media are persisted.
export class CatalogCache {
  constructor({ttl = 60000, concurrency = 3, now = () => Date.now()} = {}) {
    this.ttl = ttl; this.concurrency = concurrency; this.now = now;
    this.entries = new Map(); this.generation = 0; this.controller = null;
  }
  cancel() { this.generation++; this.controller?.abort(); }
  clear() { this.cancel(); this.entries.clear(); }
  async load(libraries, {account, sortColumn, sortType, request, onData, onError, force = false}) {
    this.cancel();
    const generation = this.generation;
    const controller = this.controller = new AbortController();
    const queue = (libraries || []).filter(item => item.category !== 'Others');
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && generation === this.generation) {
        const library = queue[cursor++];
        const key = JSON.stringify([account, library.guid, sortColumn, sortType]);
        const cached = this.entries.get(key);
        if (!force && cached && this.now() - cached.updated < this.ttl) {
          onData(library.guid, cached.data); continue;
        }
        try {
          const data = await request({ancestor_guid: library.guid, tags: {type: ['Movie', 'TV', 'Directory', 'Video']},
            exclude_grouped_video: 1, page: 1, page_size: HOME_PAGE_SIZE, sort_column: sortColumn, sort_type: sortType}, controller.signal);
          if (generation !== this.generation) return;
          if (!Array.isArray(data?.list)) throw new Error('媒体库返回格式异常');
          this.entries.set(key, {data, updated: this.now()});
          while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value);
          onData(library.guid, data);
        } catch (error) {
          if (generation === this.generation && !controller.signal.aborted) onError(library.guid, error);
        }
      }
    };
    await Promise.all(Array.from({length: Math.min(this.concurrency, queue.length)}, worker));
  }
}

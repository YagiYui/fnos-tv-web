export const HOME_PAGE_SIZE = 21;

// Short-lived account-scoped memory cache. No credentials or media are persisted.
export class CatalogCache {
  constructor({ttl = 60000, concurrency = 3, now = () => Date.now()} = {}) {
    this.ttl = ttl; this.concurrency = concurrency; this.now = now;
    this.entries = new Map(); this.generation = 0;
    this.tasks = new Map(); this.queue = []; this.active = 0;
  }
  cancel() {
    this.generation++;
    for (const task of this.tasks.values()) { task.controller.abort(); task.resolve(); }
    this.tasks.clear(); this.queue = [];
  }
  clear() { this.cancel(); this.entries.clear(); }
  async load(libraries, {account, sortColumn, sortType, request, onData, onError, force = false}) {
    await Promise.all((libraries || []).filter(item => item.category !== 'Others').map(library => {
      const key = JSON.stringify([account, library.guid, sortColumn, sortType]);
      const cached = this.entries.get(key);
      if (!force && cached && this.now() - cached.updated < this.ttl) {
        onData(library.guid, cached.data); return;
      }
      let task = this.tasks.get(key);
      if (!task) {
        task = {key, library, generation: this.generation, controller: new AbortController(), request,
          consumers: [], payload: {ancestor_guid: library.guid, tags: {type: ['Movie', 'TV', 'Directory', 'Video']},
            exclude_grouped_video: 1, page: 1, page_size: HOME_PAGE_SIZE, sort_column: sortColumn, sort_type: sortType}};
        task.promise = new Promise(resolve => { task.resolve = resolve; });
        this.tasks.set(key, task); this.queue.push(task);
      }
      task.consumers.push({onData, onError});
      this.drain();
      return task.promise;
    }));
  }
  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (task.generation !== this.generation) continue;
      this.active++;
      void this.run(task);
    }
  }
  async run(task) {
    try {
      const data = await task.request(task.payload, task.controller.signal);
      if (task.generation !== this.generation || task.controller.signal.aborted) return;
      if (!Array.isArray(data?.list)) throw new Error('媒体库返回格式异常');
      this.entries.set(task.key, {data, updated: this.now()});
      while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value);
      for (const consumer of task.consumers) consumer.onData(task.library.guid, data);
    } catch (error) {
      if (task.generation === this.generation && !task.controller.signal.aborted) {
        for (const consumer of task.consumers) consumer.onError(task.library.guid, error);
      }
    } finally {
      this.active--;
      if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
      task.resolve(); this.drain();
    }
  }
}

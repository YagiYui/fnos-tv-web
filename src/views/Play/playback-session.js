export class PlaybackSession {
  constructor() { this.generation = 0; this.controller = null; }
  cancel() { this.generation++; this.controller?.abort(); }
  begin() {
    this.cancel();
    const id = this.generation;
    const controller = this.controller = new AbortController();
    return {signal: controller.signal, isCurrent: () => id === this.generation,
      assertCurrent: () => {
        if (id !== this.generation) throw Object.assign(new Error('播放请求已取消'), {name: 'AbortError'});
      }};
  }
}

// Snapshot immediately; serialize sends and coalesce queued periodic updates.
export function createProgressReporter(snapshot, send, onError = () => {}, captureContext = () => null) {
  const queued = new Map();
  let pending = null;
  return {
    submit() {
      const data = snapshot();
      if (!data) return pending || Promise.resolve();
      const context = captureContext();
      const key = JSON.stringify([context?.account || '', data.item_guid || data.episode || 'current']);
      queued.set(key, {data, context});
      while (queued.size > 8) queued.delete(queued.keys().next().value);
      if (!pending) {
        pending = (async () => {
          while (queued.size) {
            const [key, current] = queued.entries().next().value;
            queued.delete(key);
            try { await send(current.data, current.context); } catch (error) { onError(error, current.context); }
          }
        })().finally(() => { pending = null; });
      }
      return pending;
    }
  };
}

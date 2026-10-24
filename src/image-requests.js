// Limit visible poster traffic so a cold page does not burst dozens of requests
// at the NAS image generator. Waiting for retry never occupies a request slot.
export function createImageRequestQueue(limit = 4) {
  let running = 0;
  const waiting = [];
  function pump() {
    while (running < limit && waiting.length) {
      const job = waiting.shift();
      if (job.cancelled) continue;
      running++; job.running = true;
      job.start(job.release);
    }
  }
  return {
    add(start) {
      const job = {start, running: false, cancelled: false, release() {
        if (job.cancelled) return;
        job.cancelled = true;
        if (job.running) running--;
        const index = waiting.indexOf(job);
        if (index >= 0) waiting.splice(index, 1);
        pump();
      }};
      waiting.push(job); pump();
      return job.release;
    }
  };
}
export const imageRequests = createImageRequestQueue();

export function posterUrl(base, value, width = 300, fallback = '/images/not_video.jpg') {
  if (typeof value !== 'string' || !value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  // Official poster values already contain their two directory components.
  // Only legacy bare names need the old fallback directory.
  const path = value.startsWith('/') ? value : value.includes('/') ? '/' + value : '/92/17/' + value;
  return base.replace(/\/$/, '') + path + (path.includes('?') ? '&' : '?') + 'w=' + width;
}

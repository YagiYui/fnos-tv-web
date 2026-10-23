// Only remember successful URLs, leaving image bytes and eviction to the browser.
const loaded = new Set();
const limit = 512;
export function imageLoading(src, preferred = 'lazy') { return loaded.has(src) ? 'eager' : preferred; }
export function rememberImage(event, originalSource) {
  const image = event.target;
  if (!image?.naturalWidth) return;
  const src = originalSource || image.getAttribute('src');
  if (!src) return;
  loaded.delete(src);
  loaded.add(src);
  if (loaded.size > limit) loaded.delete(loaded.values().next().value);
}

// Only bypass failed response caches on our own image proxy. Leave custom/signed URLs intact.
export function imageRetryUrl(src, attempt) {
  if (!attempt || !src.startsWith('/fnos/v/api/v1/sys/img/')) return src;
  const hashIndex = src.indexOf('#');
  const path = hashIndex < 0 ? src : src.slice(0, hashIndex);
  const hash = hashIndex < 0 ? '' : src.slice(hashIndex);
  return `${path}${path.includes('?') ? '&' : '?'}__fnos_image_retry=${attempt}${hash}`;
}

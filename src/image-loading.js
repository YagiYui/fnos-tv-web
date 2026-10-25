// Only remember successful URLs, leaving image bytes and eviction to the browser.
const loaded = new Set();
const limit = 512;
export function imageLoading(src, preferred = 'lazy') { return loaded.has(src) ? 'eager' : preferred; }
export function rememberImage(event) {
  const image = event.target;
  if (!image?.naturalWidth) return;
  const src = image.getAttribute('src');
  if (!src) return;
  loaded.delete(src);
  loaded.add(src);
  if (loaded.size > limit) loaded.delete(loaded.values().next().value);
}

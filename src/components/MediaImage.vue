<script setup>
import {computed, ref, watch, onMounted, onBeforeUnmount} from 'vue';
import {imageLoading, rememberImage, imageRetryUrl} from '../image-loading.js';
import {imageRequests} from '../image-requests.js';
const props = defineProps({src: {type: String, required: true}, alt: {type: String, default: ''}, loading: {type: String, default: 'lazy'}});
const attempt = ref(0);
const element = ref(null);
const failed = ref(false);
const requestSrc = computed(() => imageRetryUrl(props.src, attempt.value));
const delays = [250, 500, 1000, 1500, 2500];
const managed = typeof globalThis.IntersectionObserver === 'function';
const visibleSrc = ref();
const displaySrc = computed(() => managed ? visibleSrc.value : requestSrc.value);
let observer = null, eligible = false, releaseSlot = null, requestTimer = null, requestGeneration = 0;
let roundAttempt = 0;
let timer = null;
let active = true;
function cancelRetry() { if (timer !== null) clearTimeout(timer); timer = null; }
function finishRequest() {
  requestGeneration++;
  clearTimeout(requestTimer); requestTimer = null;
  const release = releaseSlot; releaseSlot = null; release?.();
}
function queueRequest() {
  if (!managed || !active || !eligible || releaseSlot || visibleSrc.value === requestSrc.value) return;
  const source = requestSrc.value;
  releaseSlot = imageRequests.add(release => {
    if (!active || source !== requestSrc.value) { release(); return; }
    const generation = ++requestGeneration;
    visibleSrc.value = source;
    requestTimer = setTimeout(() => {
      if (!active || generation !== requestGeneration) return;
      visibleSrc.value = undefined; finishRequest(); scheduleRetry();
    }, 15000);
  });
}
function isCurrent(event) { return active && event.target === element.value && event.target?.getAttribute('src') === requestSrc.value; }
function onError(event) {
  if (!isCurrent(event)) return;
  finishRequest(); scheduleRetry();
}
function scheduleRetry() {
  failed.value = true;
  if (timer !== null || roundAttempt >= delays.length) return;
  const source = props.src;
  timer = setTimeout(() => {
    timer = null;
    if (active && props.src === source) { roundAttempt++; attempt.value++; }
  }, delays[roundAttempt]);
}
function onLoad(event) {
  if (!isCurrent(event)) return;
  finishRequest();
  cancelRetry();
  failed.value = false;
  rememberImage(event, props.src);
}
function retry(event) {
  if (!failed.value) return;
  if (event?.type === 'click' || event?.type === 'keydown') { event.preventDefault(); event.stopPropagation(); }
  cancelRetry(); roundAttempt = 0; attempt.value++;
}
function recoverVisible() { if (globalThis.document?.visibilityState === 'visible' && timer === null) retry(); }
watch(() => props.src, () => { cancelRetry(); attempt.value = 0; roundAttempt = 0; failed.value = false; }, {flush: 'sync'});
watch(requestSrc, () => { finishRequest(); visibleSrc.value = undefined; queueRequest(); }, {flush: 'sync'});
watch(element, (next, previous) => { if (previous) observer?.unobserve(previous); if (next) observer?.observe(next); }, {flush: 'post'});
onMounted(() => {
  if (managed) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target !== element.value) continue;
        eligible = entry.isIntersecting;
        if (eligible) queueRequest();
        else if (!visibleSrc.value) finishRequest();
      }
    }, {rootMargin: '300px'});
    if (element.value) observer.observe(element.value);
  }
  globalThis.window?.addEventListener('online', retry);
  globalThis.window?.addEventListener('fnos-retry-images', retry);
  globalThis.document?.addEventListener('visibilitychange', recoverVisible);
});
onBeforeUnmount(() => {
  active = false; cancelRetry(); finishRequest(); observer?.disconnect();
  globalThis.window?.removeEventListener('online', retry);
  globalThis.window?.removeEventListener('fnos-retry-images', retry);
  globalThis.document?.removeEventListener('visibilitychange', recoverVisible);
});
</script>

<template>
  <img ref="element" :key="`${attempt}:${src}`" :src="displaySrc" :alt="failed ? `${alt} · 封面加载失败，点击重试` : alt" :loading="managed ? 'eager' : imageLoading(src, loading)" decoding="async"
       :class="{'media-image-failed': failed}" :title="failed ? '封面加载失败，点击重试' : undefined" :role="failed ? 'button' : undefined" :tabindex="failed ? 0 : undefined"
       @click="retry" @keydown.enter="retry" @keydown.space="retry" @load="onLoad" @error="onError">
</template>

<style scoped>
.media-image-failed{cursor:pointer;color:var(--cinema-muted,#aeb7c5);font-size:12px;line-height:1.6;background:var(--cinema-line,#242731)}
.media-image-failed:focus-visible{outline:2px solid #6daaff;outline-offset:-3px}
</style>

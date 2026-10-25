<script setup>
import {computed, ref, watch, onMounted, onBeforeUnmount} from 'vue';
import {imageLoading, rememberImage, imageRetryUrl} from '../image-loading.js';
const props = defineProps({src: {type: String, required: true}, alt: {type: String, default: ''}, loading: {type: String, default: 'lazy'}});
const attempt = ref(0);
const element = ref(null);
const failed = ref(false);
const requestSrc = computed(() => imageRetryUrl(props.src, attempt.value));
const delays = [500, 1500, 3000, 8000, 15000];
let roundAttempt = 0;
let timer = null;
let active = true;
function cancelRetry() { if (timer !== null) clearTimeout(timer); timer = null; }
function isCurrent(event) { return active && event.target === element.value && event.target?.getAttribute('src') === requestSrc.value; }
function onError(event) {
  if (!isCurrent(event)) return;
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
onMounted(() => {
  globalThis.window?.addEventListener('online', retry);
  globalThis.window?.addEventListener('fnos-retry-images', retry);
  globalThis.document?.addEventListener('visibilitychange', recoverVisible);
});
onBeforeUnmount(() => {
  active = false; cancelRetry();
  globalThis.window?.removeEventListener('online', retry);
  globalThis.window?.removeEventListener('fnos-retry-images', retry);
  globalThis.document?.removeEventListener('visibilitychange', recoverVisible);
});
</script>

<template>
  <img ref="element" :key="`${attempt}:${src}`" :src="requestSrc" :alt="failed ? `${alt} · 封面加载失败，点击重试` : alt" :loading="imageLoading(src, loading)" decoding="async"
       :class="{'media-image-failed': failed}" :title="failed ? '封面加载失败，点击重试' : undefined" :role="failed ? 'button' : undefined" :tabindex="failed ? 0 : undefined"
       @click="retry" @keydown.enter="retry" @keydown.space="retry" @load="onLoad" @error="onError">
</template>

<style scoped>
.media-image-failed{cursor:pointer;color:var(--cinema-muted,#aeb7c5);font-size:12px;line-height:1.6;background:var(--cinema-line,#242731)}
.media-image-failed:focus-visible{outline:2px solid #6daaff;outline-offset:-3px}
</style>

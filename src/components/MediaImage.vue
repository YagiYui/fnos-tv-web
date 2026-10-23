<script setup>
import {computed, ref, watch, onBeforeUnmount} from 'vue';
import {imageLoading, rememberImage, imageRetryUrl} from '../image-loading.js';
const props = defineProps({src: {type: String, required: true}, alt: {type: String, default: ''}, loading: {type: String, default: 'lazy'}});
const attempt = ref(0);
const element = ref(null);
const requestSrc = computed(() => imageRetryUrl(props.src, attempt.value));
const delays = [500, 1500, 3000];
let timer = null;
let active = true;
function cancelRetry() { if (timer !== null) clearTimeout(timer); timer = null; }
function isCurrent(event) { return active && event.target === element.value && event.target?.getAttribute('src') === requestSrc.value; }
function onError(event) {
  if (!isCurrent(event) || timer !== null || attempt.value >= delays.length) return;
  const source = props.src;
  timer = setTimeout(() => {
    timer = null;
    if (active && props.src === source) attempt.value++;
  }, delays[attempt.value]);
}
function onLoad(event) {
  if (!isCurrent(event)) return;
  cancelRetry();
  rememberImage(event, props.src);
}
watch(() => props.src, () => { cancelRetry(); attempt.value = 0; }, {flush: 'sync'});
onBeforeUnmount(() => { active = false; cancelRetry(); });
</script>

<template>
  <img ref="element" :key="`${attempt}:${src}`" :src="requestSrc" :alt="alt" :loading="imageLoading(src, loading)" @load="onLoad" @error="onError">
</template>

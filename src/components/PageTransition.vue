<script setup>
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {useRoute} from 'vue-router';

const route = useRoute();
const surface = ref(null);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let animation;

function cancelAnimation() {
  animation?.cancel();
  animation = undefined;
}

function enterPage() {
  cancelAnimation();
  if (reducedMotion.matches || !surface.value?.animate) return;

  // Never transform the player: fullscreen and fixed controls keep their viewport.
  const frames = route.path === '/player'
    ? [{opacity: 0}, {opacity: 1}]
    : [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}];
  animation = surface.value.animate(frames, {
    duration: 180,
    easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)',
  });
}

watch(() => route.fullPath, (_, previous) => {
  // Query updates during playback (such as changing episodes) stay uninterrupted.
  if (route.path === '/player' && previous?.split('?')[0].split('#')[0] === '/player') return;
  enterPage();
}, {flush: 'post'});

onMounted(() => {
  reducedMotion.addEventListener('change', cancelAnimation);
  enterPage();
});
onBeforeUnmount(() => {
  reducedMotion.removeEventListener('change', cancelAnimation);
  cancelAnimation();
});
</script>

<template>
  <div ref="surface" class="page-transition"><slot /></div>
</template>

<style scoped>
.page-transition {
  min-width: 0;
}
</style>

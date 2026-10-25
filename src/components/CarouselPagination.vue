<script setup>
defineProps({current: {type: Number, default: 0}, count: {type: Number, default: 1}})
defineEmits(['change'])
</script>

<template>
  <nav v-if="count > 1" class="mobile-carousel-pagination" aria-label="横向列表分页">
    <template v-if="count <= 7">
      <button v-for="position in count" :key="position" type="button"
              :aria-label="`转到第 ${position} 页`"
              :aria-current="current === position - 1 ? 'true' : undefined"
              @click="$emit('change', position - 1)"><span></span></button>
    </template>
    <span v-else class="carousel-page-count" aria-live="polite" aria-atomic="true">{{ Math.min(current + 1, count) }} <span>/ {{ count }}</span></span>
  </nav>
</template>

<style scoped>
.mobile-carousel-pagination{display:flex;align-items:center;justify-content:center;min-height:28px;margin-top:10px;gap:0;touch-action:pan-y}
.mobile-carousel-pagination button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;background:transparent;cursor:pointer;border-radius:8px}
.mobile-carousel-pagination button>span{width:5px;height:5px;border-radius:5px;background:var(--cinema-muted);opacity:.35;transition:width .18s,opacity .18s}
.mobile-carousel-pagination button[aria-current=true]>span{width:17px;background:var(--cinema-text);opacity:.85}
.mobile-carousel-pagination button:focus-visible{outline:2px solid var(--cinema-accent);outline-offset:1px}
.carousel-page-count{font-size:11px;line-height:28px;font-variant-numeric:tabular-nums;color:var(--cinema-text);letter-spacing:1px;opacity:.8}
.carousel-page-count>span{color:var(--cinema-muted)}
@media(prefers-reduced-motion:reduce){.mobile-carousel-pagination button>span{transition:none}}
</style>

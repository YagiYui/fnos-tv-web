<script setup>
import {computed, ref, watch, onMounted, onUnmounted} from 'vue'
import CarouselPagination from './CarouselPagination.vue'
import {startSwipe, moveSwipe, finishSwipe} from './direction-locked-swipe.js'

const props = defineProps({items: {type: Array, default: () => []}, perView: {type: Number, default: 3}, mobile: Boolean})
const current = ref(0)
const carousel = ref(null)
const mouseQuery = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
const touchQuery = window.matchMedia('(any-pointer: coarse)')
const hasMouse = ref(mouseQuery.matches)
const hasTouch = ref(touchQuery.matches || navigator.maxTouchPoints > 0)
const usedTouch = ref(false)
const showPagination = computed(() => props.mobile || hasTouch.value || usedTouch.value)
function updateInputCapabilities() {
  hasMouse.value = mouseQuery.matches
  hasTouch.value = touchQuery.matches || navigator.maxTouchPoints > 0
}
onMounted(() => {
  mouseQuery.addEventListener('change', updateInputCapabilities)
  touchQuery.addEventListener('change', updateInputCapabilities)
})
onUnmounted(() => {
  mouseQuery.removeEventListener('change', updateInputCapabilities)
  touchQuery.removeEventListener('change', updateInputCapabilities)
})
let swipe = null
let suppressClickUntil = 0
function touchStart(event) {
  usedTouch.value = true
  swipe = event.touches.length === 1 ? startSwipe(event.touches[0]) : null
}
function touchMove(event) {
  if (event.touches.length !== 1) { swipe = null; return }
  moveSwipe(swipe, event.touches[0])
}
function touchEnd(event) {
  if (!swipe || !event.changedTouches.length) return
  const delta = finishSwipe(swipe, event.changedTouches[0], event.currentTarget.clientWidth)
  if (swipe.direction === 'horizontal') suppressClickUntil = Date.now() + 450
  swipe = null
  if (delta) carousel.value?.to(Math.max(0, Math.min(pages.value.length - 1, current.value + delta)))
}
function guardSwipeClick(event) {
  if (Date.now() < suppressClickUntil) {
    event.preventDefault()
    event.stopPropagation()
  }
}
const pages = computed(() => {
  const result = []
  for (let i = 0; i < props.items.length; i += props.perView) result.push(props.items.slice(i, i + props.perView))
  return result
})
watch(() => [props.mobile, props.perView, props.items.map(item => item.guid).join(',')], () => {
  current.value = 0
  swipe = null
  carousel.value?.to(0)
})
</script>

<template>
    <div class="mobile-carousel-gesture" @touchstart.passive="touchStart" @touchmove.passive="touchMove"
         @touchend.passive="touchEnd" @touchcancel="swipe = null" @click.capture="guardSwipeClick">
    <n-carousel ref="carousel" :show-dots="false" :show-arrow="hasMouse && pages.length > 1" :loop="false" :touchable="false" :draggable="hasMouse"
                :slides-per-view="1" :space-between="18" @update:current-index="current = $event">
      <div v-for="(page, index) in pages" :key="index" class="mobile-carousel-page" :style="{'--page-columns': perView}">
        <slot v-for="item in page" :key="item.guid" :item="item" />
      </div>
    </n-carousel>
    </div>
    <CarouselPagination v-if="showPagination" :current="current" :count="pages.length" @change="carousel?.to($event)" />
</template>

<style scoped>
.mobile-carousel-gesture{touch-action:pan-y pinch-zoom}
.mobile-carousel-page{display:grid;grid-template-columns:repeat(var(--page-columns),minmax(0,1fr));gap:18px;align-items:start}
</style>

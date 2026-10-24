<script setup>
import {computed, onMounted, onBeforeUnmount, ref, watch} from 'vue';
const props = defineProps({modelValue: {type: String, default: ''}, history: {type: Array, default: () => []}});
const emit = defineEmits(['update:modelValue', 'submit', 'clear', 'choose', 'clear-history']);
const root = ref(null), input = ref(null), opened = ref(false);
const showHistory = computed(() => opened.value && props.history.length > 0);
function submit(event) {
  if (event?.isComposing) return;
  opened.value = false;
  emit('submit', event);
}
function submitFromInput(event) { if (event.target?.tagName === 'INPUT') submit(event); }
function choose(value) { opened.value = false; emit('choose', value); }
function clearHistory() { emit('clear-history'); input.value?.focus(); opened.value = false; }
function closeFromOutside(event) { if (!root.value?.contains(event.target)) opened.value = false; }
function leaveFocus(event) { if (!root.value?.contains(event.relatedTarget)) opened.value = false; }
function escape(event) { event.stopPropagation(); input.value?.focus(); opened.value = false; }
watch(() => props.history.length, length => { if (!length) opened.value = false; });
onMounted(() => document.addEventListener('pointerdown', closeFromOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeFromOutside));
</script>

<template>
  <div ref="root" class="home-search" @focusout="leaveFocus" @keydown.esc="escape">
    <n-input ref="input" :value="modelValue" @update:value="emit('update:modelValue', $event)" clearable size="large"
             class="home-search-input" placeholder="搜索全库，回车提交"
             :input-props="{'aria-label': '搜索全库', 'aria-expanded': Boolean(showHistory), 'aria-controls': showHistory ? 'home-search-history' : undefined, autocomplete: 'off'}"
             @focus="opened = true" @click="opened = true" @keydown.enter="submitFromInput" @clear="emit('clear')">
      <template #prefix><i class="bx bx-search" aria-hidden="true" /></template>
      <template #suffix><n-button text :disabled="!modelValue.trim()" aria-label="提交全库搜索" @click.stop="submit"><i class="bx bx-right-arrow-alt" aria-hidden="true" /></n-button></template>
    </n-input>
    <section v-if="showHistory" id="home-search-history" class="home-search-history" aria-label="搜索历史">
      <div class="history-heading"><span>搜索历史</span><button type="button" class="history-clear" @click="clearHistory">清空历史</button></div>
      <div class="history-entries">
        <button v-for="value in history" :key="value" type="button" class="history-entry" @click="choose(value)">
          <i class="bx bx-history" aria-hidden="true" /><span>{{ value }}</span><i class="bx bx-right-arrow-alt" aria-hidden="true" />
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-search{position:relative;width:min(720px,100%);margin:0 0 30px}
.home-search-input{width:100%;border-radius:12px;font-size:15px;--n-height:46px!important}
.home-search-input :deep(.n-input__prefix){font-size:20px;margin-right:10px;color:var(--cinema-muted)}
.home-search-input :deep(.n-input__suffix){margin-left:10px}.home-search-input :deep(.n-button){font-size:21px;min-width:30px}
.home-search-history{position:absolute;top:calc(100% + 8px);left:0;right:0;z-index:20;box-sizing:border-box;border:1px solid var(--cinema-line);border-radius:12px;background:var(--cinema-panel);box-shadow:0 12px 32px #0002;padding:12px 8px 8px}
.history-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 10px 8px;font-size:12px;color:var(--cinema-muted)}
.home-search-history button{font:inherit;color:inherit;border:0;background:none;cursor:pointer}.history-clear{padding:4px!important;color:var(--cinema-muted)!important}
.history-entries{max-height:min(320px,45dvh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.history-entry{display:flex;align-items:center;gap:12px;width:100%;min-height:42px;padding:10px;border-radius:8px;text-align:left;font-size:14px!important}
.history-entry>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-entry>.bx{font-size:17px;color:var(--cinema-muted)}
.history-entry:hover,.history-entry:focus-visible{background:var(--cinema-line)}.home-search-history button:focus-visible{outline:2px solid var(--cinema-accent);outline-offset:-2px}
@media(max-width:540px){.home-search{margin-bottom:24px}.home-search-input{font-size:14px;--n-height:44px!important}}
</style>

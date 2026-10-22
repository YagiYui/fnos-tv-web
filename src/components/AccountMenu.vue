<script setup>
import {computed, nextTick, ref, watch} from 'vue';

const props = defineProps({
  username: {type: String, default: ''},
  serverName: {type: String, default: ''},
  libraryCount: {type: Number, default: null},
  serviceVersion: {type: String, default: ''},
  themeMode: {type: String, default: 'system'},
  historyCount: {type: Number, default: 0}
});
const emit = defineEmits(['theme', 'clear-history', 'logout']);
const showMenu = ref(false);
const triggerButton = ref(null);
const card = ref(null);
const displayName = computed(() => props.username.trim() || '当前账户');
const initial = computed(() => Array.from(displayName.value)[0].toLocaleUpperCase());
const modes = [{key: 'system', label: '跟随系统'}, {key: 'light', label: '浅色'}, {key: 'dark', label: '深色'}];

watch(showMenu, async shown => {
  if (shown) { await nextTick(); card.value?.focus(); }
});
async function closeMenu() {
  showMenu.value = false;
  await nextTick();
  triggerButton.value?.$el?.focus();
}
function logout() { showMenu.value = false; emit('logout'); }
</script>

<template>
  <n-popover v-model:show="showMenu" trigger="click" placement="bottom-end" :show-arrow="false" :width="304" :style="{maxWidth: 'calc(100vw - 24px)', padding: '0'}">
    <template #trigger>
      <n-button ref="triggerButton" class="account-trigger" quaternary circle :title="'账户：' + displayName" aria-label="打开账户菜单" aria-haspopup="dialog" :aria-expanded="showMenu" aria-controls="fnos-account-card" @keydown.esc.stop.prevent="closeMenu">
        <n-avatar circle size="medium" class="user-avatar" aria-hidden="true">{{ initial }}</n-avatar>
      </n-button>
    </template>
    <section id="fnos-account-card" ref="card" class="account-card" role="dialog" aria-labelledby="fnos-account-name" tabindex="-1" @keydown.esc.stop.prevent="closeMenu">
      <div class="account-heading">
        <n-avatar circle :size="44" class="account-avatar" aria-hidden="true">{{ initial }}</n-avatar>
        <div><h2 id="fnos-account-name">{{ displayName }}</h2><p>当前登录账户</p></div>
      </div>
      <dl class="account-details">
        <div><dt>服务器</dt><dd>{{ serverName || '未获取' }}</dd></div>
        <div><dt>可见媒体库</dt><dd>{{ libraryCount === null ? '未获取' : libraryCount + ' 个' }}</dd></div>
        <div><dt>飞牛系统版本</dt><dd>{{ serviceVersion || '未获取' }}</dd></div>
      </dl>
      <div class="account-appearance">
        <span>外观</span>
        <div class="account-theme-options" role="group" aria-label="外观模式">
          <n-button v-for="mode in modes" :key="mode.key" size="small" secondary :type="themeMode === mode.key ? 'primary' : 'default'" :aria-pressed="themeMode === mode.key" @click="emit('theme', mode.key)">{{ mode.label }}</n-button>
        </div>
      </div>
      <div class="account-actions">
        <n-button quaternary block :disabled="historyCount === 0" @click="emit('clear-history')"><template #icon><i class="bx bx-history" aria-hidden="true"></i></template>清空本账号搜索历史<span class="account-history-count">{{ historyCount }}</span></n-button>
        <n-button quaternary block type="error" @click="logout"><template #icon><i class="bx bx-log-out" aria-hidden="true"></i></template>退出登录</n-button>
      </div>
    </section>
  </n-popover>
</template>

<style scoped>
.account-card{box-sizing:border-box;width:100%;padding:20px;outline:none;color:var(--cinema-text);background:var(--cinema-panel);border-radius:8px}
.account-heading{display:flex;align-items:center;gap:12px;margin-bottom:18px}.account-heading>div{min-width:0}.account-heading h2{font-size:16px;line-height:1.5;margin:0;overflow-wrap:anywhere}.account-heading p{font-size:12px;color:var(--cinema-muted);margin:3px 0 0}.account-avatar{flex-shrink:0;background:var(--cinema-soft);color:var(--cinema-accent)}
.account-details{display:grid;gap:12px;margin:0;padding:0 0 18px;border-bottom:1px solid var(--cinema-line);font-size:12px}.account-details>div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:12px}.account-details dt{color:var(--cinema-muted)}.account-details dd{margin:0;text-align:right;overflow-wrap:anywhere}
.account-appearance{padding:16px 0;display:grid;gap:10px;font-size:12px;color:var(--cinema-muted)}.account-theme-options{display:flex;gap:6px;flex-wrap:wrap}.account-theme-options .n-button{flex:1;min-width:0}.account-actions{display:grid;gap:4px;padding-top:10px;border-top:1px solid var(--cinema-line)}.account-history-count{margin-left:8px;color:var(--cinema-muted);font-variant-numeric:tabular-nums}
.account-trigger{flex-shrink:0}.account-card :deep(.n-button__content){white-space:normal}.account-actions :deep(.n-button__content){font-size:12px}
.account-card .account-avatar{top:0;width:44px!important;height:44px!important;font-size:20px!important}
.account-card :deep(button:focus-visible){outline:2px solid var(--cinema-accent);outline-offset:2px}
</style>

<script setup>
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
const props = defineProps({request: Function, episodeGuid: String, parentGuid: String});
const emit = defineEmits(['close', 'saved']);
const config = ref(null), canManage = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const scope = ref('user'), preferred = ref('auto'), fallback = ref(true), currentScope = ref('service');
const checkKeyword = ref(''), checkResult = ref('');
let active = true;
const controller = new AbortController();
const cleanConfig = value => ({...value, custom: (value.custom || []).map(row => ({...row, auth_mode: row.auth_mode || 'bearer', token: '', clear_token: false}))});
const choices = computed(() => [{value: 'auto', label: '自动（服务默认顺序）'}, ...['providers','custom'].flatMap(key =>
  (config.value?.[key] || []).filter(row => row.enabled).map(row => ({value: row.id, label: row.name})))]);
async function execute(job) {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await job(); } catch (failure) { if (active && failure.name !== 'AbortError') error.value = failure.message || '操作失败'; }
  finally { if (active) busy.value = false; }
}
const request = (path, options = {}) => props.request(path, {...options, signal: controller.signal});
async function load() {
  await execute(async () => {
    const [sources, selection] = await Promise.all([request('/danmu/sources'), request('/danmu/sources/preferences?' + new URLSearchParams({guid: props.episodeGuid, parent_guid: props.parentGuid}))]);
    if (!active) return;
    config.value = cleanConfig(sources.data); canManage.value = sources.can_manage;
    preferred.value = selection.data.source_id; fallback.value = selection.data.fallback; currentScope.value = selection.data.scope;
  });
}
function move(kind, index, offset) {
  const rows = config.value[kind], next = index + offset;
  if (busy.value || next < 0 || next >= rows.length) return;
  [rows[index], rows[next]] = [rows[next], rows[index]];
}
function addCustom() {
  config.value.custom.push({id: 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), name: '自定义弹幕', protocol: 'dandanplay-v2',
    url: '', enabled: false, allow_private: false, timeout: 10, auth_mode: 'bearer', token: '', has_token: false});
}
async function saveConfig() {
  await execute(async () => {
    const result = await request('/danmu/sources', {method: 'PUT', body: JSON.stringify(config.value)});
    if (!active) return;
    config.value = cleanConfig(result.data); notice.value = '服务来源已保存，启用与顺序对新请求生效'; emit('saved');
  });
}
async function savePreference(remove = false) {
  await execute(async () => {
    const result = await request('/danmu/sources/preferences', {method: remove ? 'DELETE' : 'PUT', body: JSON.stringify({
      scope: scope.value, guid: props.episodeGuid, parent_guid: props.parentGuid, source_id: preferred.value, fallback: fallback.value})});
    if (!active) return;
    preferred.value = result.data.source_id; fallback.value = result.data.fallback; currentScope.value = result.data.scope;
    notice.value = remove ? '已清除此范围覆盖，按上层设置匹配' : '个人偏好已保存，重新加载当前集弹幕'; emit('saved');
  });
}
async function check(row) {
  await execute(async () => {
    const result = await request('/danmu/sources/check', {method: 'POST', body: JSON.stringify({id: row.id, keyword: checkKeyword.value.trim() || '测试'})});
    if (!active) return;
    const stages = result.data;
    checkResult.value = `${row.name}：连接／搜索通过；分集${stages.episodes === true ? '通过' : '未验证（搜索为空）'}；弹幕${stages.comments === true ? `通过（${stages.comment_count} 条）` : '未验证'}`;
  });
}
const status = row => row.last_result ? ({ok: '最近成功', empty: '最近结果为空', failed: '最近请求失败'})[row.last_result.outcome] : '尚无请求记录';
onMounted(load);
onBeforeUnmount(() => { active = false; controller.abort(); });
</script>

<template>
  <n-modal :show="true" preset="card" title="弹幕来源与偏好" :style="{width:'min(740px,94vw)',maxHeight:'85vh',overflowY:'auto'}" @update:show="value => {if (!value) emit('close')}">
    <n-space vertical :size="16">
      <n-alert v-if="error" type="error" :show-icon="false">{{ error }}</n-alert>
      <n-alert v-if="notice" type="success" :show-icon="false">{{ notice }}</n-alert>
      <n-button v-if="!config" :loading="busy" @click="load">重新加载</n-button>
      <template v-if="config">
        <n-text>个人偏好（当前生效范围：{{ currentScope.startsWith('episode:') ? '单集' : currentScope.startsWith('season:') ? '季度／影片' : currentScope === 'user' ? '账号' : '服务默认' }}）</n-text>
        <n-text depth="3">单集覆盖优先于季度／影片，其次账号偏好和服务默认；被管理员禁用的来源不会重新启用。仅当前集绑定失败时提示手动换源。</n-text>
        <n-select v-model:value="preferred" :options="choices" :disabled="busy" />
        <n-select v-model:value="scope" :disabled="busy" :options="[{value:'user',label:'本账号默认'},{value:'season',label:'当前季度／影片'},{value:'episode',label:'仅当前集'}]" />
        <n-checkbox v-model:checked="fallback" :disabled="busy">首选为空或失败时按服务顺序回退（不覆盖明确绑定的分集链接）</n-checkbox>
        <n-space><n-button :loading="busy" @click="savePreference(false)">保存个人偏好</n-button><n-button :disabled="busy" @click="savePreference(true)">清除此范围覆盖</n-button></n-space>
        <n-divider />
        <n-text>{{ canManage ? '服务级来源（管理员）' : '服务级来源（只读）' }}</n-text>
        <template v-for="kind in ['providers','searches']" :key="kind">
          <n-text>{{ kind === 'providers' ? '内置弹幕平台 · 从上到下依次尝试' : '候选搜索入口 · 与弹幕平台分别控制' }}</n-text>
          <div v-for="(row,index) in config[kind]" :key="row.id" class="source-row">
            <n-checkbox v-model:checked="row.enabled" :disabled="!canManage || busy">{{ row.name }}</n-checkbox>
            <n-text depth="3">{{ status(row) }}</n-text>
            <n-space :size="4" v-if="canManage"><n-button size="tiny" :disabled="busy || !index" @click="move(kind,index,-1)">上移</n-button><n-button size="tiny" :disabled="busy || index === config[kind].length-1" @click="move(kind,index,1)">下移</n-button></n-space>
          </div>
        </template>
        <n-checkbox v-model:checked="config.fallback" :disabled="!canManage || busy">服务默认允许自动回退；每集选首个非空来源</n-checkbox>
        <n-select v-model:value="config.default_source" :options="choices" :disabled="!canManage || busy" placeholder="服务默认首选来源" />
        <n-text>自定义 Dandanplay v2 兼容服务</n-text>
        <n-text depth="3">服务地址填站点或路径前缀，不含 /api/v2 后缀；支持搜索、分集、JSON 弹幕，不支持异步分片或官方应用签名。保存后再检查，连接成功不代表全部协议兼容。</n-text>
        <div v-for="(row,index) in config.custom" :key="row.id" class="custom-source">
          <n-checkbox v-model:checked="row.enabled" :disabled="!canManage || busy">启用 {{ row.name }}</n-checkbox>
          <n-space vertical v-if="canManage">
            <n-input v-model:value="row.name" placeholder="来源名称" :disabled="busy" />
            <n-input v-model:value="row.url" placeholder="服务地址，例如 https://danmaku.example" :disabled="busy" />
            <n-select v-model:value="row.auth_mode" :options="[{value:'bearer',label:'Bearer 鉴权'},{value:'path',label:'路径令牌（不填入服务地址）'}]" :disabled="busy" />
            <n-input v-model:value="row.token" type="password" show-password-on="click" :placeholder="row.has_token ? '鉴权已保存，留空保留；不回显' : '可选鉴权令牌'" :disabled="busy" />
            <n-checkbox v-if="row.has_token" v-model:checked="row.clear_token" :disabled="busy">清除已保存鉴权</n-checkbox>
            <n-checkbox v-model:checked="row.allow_private" :disabled="busy">允许访问内网服务（仅可信服务）</n-checkbox>
            <n-input-number v-model:value="row.timeout" :min="2" :max="30" :disabled="busy"><template #suffix>秒超时</template></n-input-number>
            <n-space><n-button :disabled="busy" @click="check(row)">检查已保存配置</n-button><n-button :disabled="busy" @click="config.custom.splice(index,1)">移除此来源</n-button></n-space>
          </n-space>
        </div>
        <n-input v-if="canManage && config.custom.length" v-model:value="checkKeyword" placeholder="协议检查用片名；空搜索不能验证分集和弹幕" />
        <n-alert v-if="checkResult" type="info" :show-icon="false">{{ checkResult }}</n-alert>
        <n-space v-if="canManage"><n-button :disabled="busy || config.custom.length >= 8" @click="addCustom">添加自定义服务</n-button><n-button type="primary" :loading="busy" @click="saveConfig">保存服务来源</n-button></n-space>
      </template>
    </n-space>
  </n-modal>
</template>

<style scoped>
.source-row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:6px 0}
.custom-source{border:1px solid #8885;border-radius:6px;padding:12px;display:grid;gap:10px}
</style>

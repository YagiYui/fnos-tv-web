<script setup>
// 获取 Vue 实例
import {getCurrentInstance, onMounted, onBeforeUnmount, ref, computed, watch, inject, nextTick} from "vue";
import {useMediaDbData, useLibraryViews} from '@/store.js'
import {onBeforeRouteUpdate, onBeforeRouteLeave} from "vue-router";

const MediaDbData = useMediaDbData()
const libraryViews = useLibraryViews();
const sortColumn = ref('create_time');
const sortType = ref('DESC');
const pageScroll = inject('pageScroll', {getTop: () => window.scrollY, scrollTo: top => window.scrollTo(0, top)});

const guid = ref(null);
const libraryTitle = computed(() => MediaDbData.list?.find(item => item.guid === guid.value)?.title || '媒体库');
const mode = computed({
  get: () => sortColumn.value,
  set: (value) => {
    sortColumn.value = value;
  }
});
const order = computed({
  get: () => sortType.value,
  set: (value) => {
    sortType.value = value;
  }
});
const showSort = ref(false);
const size = ref(48);
const page = ref(1);
const MediaDbInfo = ref([]);
const total = ref(null);
const listLoading = ref(false);
const listError = ref('');
let listGeneration = 0;
let controller = null;
let applyingView = false;
let viewGeneration = 0;
let resultKey = '';
let viewAccount = null;
const hasNextPage = computed(() => total.value !== null ? page.value * size.value < total.value : MediaDbInfo.value.length === size.value);
const totalPages = computed(() => total.value !== null ? Math.max(1, Math.ceil(total.value / size.value)) : null);


const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;


const modes = [
  {
    value: 'sort_title',
    label: '标题'
  },
  {
    value: 'vote_average',
    label: '评分'
  },
  {
    value: 'release_date',
    label: '发行年份'
  },
  {
    value: 'create_time',
    label: '添加日期'
  }
]

const orders = [
  {
    value: "ASC",
    label: "升序"
  },
  {
    value: 'DESC',
    label: '降序'
  }
]


function queryKey() { return JSON.stringify([guid.value, mode.value, order.value, page.value]); }
function cancelPending() {
  listGeneration++;
  controller?.abort();
  controller = null;
  listLoading.value = false;
}
function saveView() {
  const hasData = resultKey === queryKey();
  libraryViews.save(viewAccount, guid.value, {mode: mode.value, order: order.value,
    page: hasData ? page.value : 1, size: size.value, total: hasData ? total.value : null,
    items: hasData ? MediaDbInfo.value : [], hasData, scrollY: hasData ? pageScroll.getTop() : 0});
}
async function loadLibrary(id) {
  const generation = ++viewGeneration;
  cancelPending();
  viewAccount = COMMON.userKey;
  guid.value = typeof id === 'string' ? id : '';
  if (!guid.value) { MediaDbInfo.value = []; resultKey = ''; listError.value = '请选择有效的媒体库'; return; }
  const saved = libraryViews.get(viewAccount, guid.value);
  applyingView = true;
  mode.value = saved?.mode || 'create_time';
  order.value = saved?.order || 'DESC';
  page.value = saved?.page || 1;
  MediaDbInfo.value = saved?.items || [];
  total.value = saved?.total ?? null;
  resultKey = saved?.hasData ? queryKey() : '';
  listLoading.value = true;
  await nextTick();
  if (generation !== viewGeneration) return;
  applyingView = false;
  if (saved?.hasData) pageScroll.scrollTo(saved.scrollY);
  // Revalidate the saved page, keeping a restored page usable during a slow refresh.
  await GetMediaDbInfos(page.value, saved?.hasData ? {preserveScroll: true} : {scrollTop: saved?.scrollY || 0});
}
async function GetMediaDbInfos(targetPage = page.value, {preserveScroll = false, scrollTop = 0} = {}) {
  controller?.abort();
  const requestController = controller = new AbortController();
  const account = COMMON.userKey;
  const generation = ++listGeneration;
  const isCurrent = () => generation === listGeneration && !requestController.signal.aborted && account === COMMON.userKey && account === viewAccount;
  listLoading.value = true;
  listError.value = '';
  const request = {
    ancestor_guid: guid.value,
    tags: {type: ['Movie', 'TV', 'Directory', 'Video']},
    exclude_grouped_video: 1,
    page: targetPage,
    page_size: size.value,
    sort_type: order.value,
    sort_column: mode.value
  };
  try {
    const res = await COMMON.requests('POST', '/api/v1/item/list', true, request, {signal: requestController.signal});
    if (!isCurrent()) return;
    if (!Array.isArray(res?.list)) throw new Error('片库加载失败，请重试');
    const count = res.total == null ? NaN : Number(res.total);
    const knownTotal = Number.isFinite(count) && count >= 0 ? count : null;
    if (knownTotal === null && targetPage > page.value && !res.list.length && MediaDbInfo.value.length) {
      total.value = (page.value - 1) * size.value + MediaDbInfo.value.length;
      return;
    }
    if (targetPage > 1 && !res.list.length) {
      const last = knownTotal === null ? 1 : Math.max(1, Math.ceil(knownTotal / size.value));
      const fallback = Math.min(page.value, last);
      return await GetMediaDbInfos(fallback === targetPage ? 1 : fallback);
    }
    MediaDbInfo.value = res.list;
    page.value = targetPage;
    total.value = knownTotal;
    resultKey = queryKey();
    if (!preserveScroll) {
      await nextTick();
      if (isCurrent()) pageScroll.scrollTo(scrollTop);
    }
  } catch (error) {
    if (isCurrent()) listError.value = error?.message || '片库加载失败，请重试';
  } finally {
    if (isCurrent()) { listLoading.value = false; controller = null; }
  }
}
async function BackPage() {
  if (listLoading.value || page.value <= 1) return;
  await GetMediaDbInfos(page.value - 1);
}
async function NextPage() {
  if (listLoading.value || !hasNextPage.value) return;
  await GetMediaDbInfos(page.value + 1);
}
watch([mode, order], () => { if (!applyingView) void GetMediaDbInfos(1); });
onBeforeRouteUpdate(to => {
  if (to.query.gallery_uid !== guid.value) { saveView(); viewGeneration++; cancelPending(); }
});
watch(() => proxy.$route.query.gallery_uid, id => { void loadLibrary(id); });
onBeforeRouteLeave(() => { saveView(); viewGeneration++; cancelPending(); });
onBeforeUnmount(() => { viewGeneration++; cancelPending(); });
onMounted(async () => { await loadLibrary(proxy.$route.query.gallery_uid); });
</script>

<template>

  <div class="content catalog-page">
    <div class="library-toolbar list-toolbar">
      <div><h1>{{ libraryTitle }}</h1><p class="page-description"><span v-if="total !== null">{{ total }} 部影片 · </span>第 {{ page }} 页<span v-if="totalPages"> / 共 {{ totalPages }} 页</span><span v-if="listLoading"> · 加载中</span></p></div>
      <div class="catalog-actions">
        <n-button @click="showSort = !showSort" secondary><template #icon><i class="bx bx-sort-alt-2"></i></template>排序</n-button>
        <n-button @click="BackPage()" :disabled="listLoading || page <= 1" aria-label="上一页" title="上一页" secondary circle><i class="bx bx-chevron-left"></i></n-button>
        <n-button @click="NextPage()" :disabled="listLoading || !hasNextPage" aria-label="下一页" title="下一页" secondary circle><i class="bx bx-chevron-right"></i></n-button>
      </div>
    </div>
    <n-alert v-if="listError" type="error" style="margin-bottom: 16px">{{ listError }} <n-button text @click="GetMediaDbInfos()">重试</n-button></n-alert>
    <div class="card-show-content view-card-list" :aria-busy="listLoading">
      <div class="view-item poster-card" v-for="item in MediaDbInfo" :key="item.guid">
        <router-link :to="{
                    path: '/video', query: {
                        guid: item.guid,
                        gallery_type: item.type
                    }
                }">
          <div class="poster-art"><img v-lazy="item.poster ? COMMON.imgUrl + '/92/17/' + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title || item.name" loading="lazy"><span class="poster-play"><i class="bx bx-play"></i></span><span v-if="item.played" class="poster-watched"><i class="bx bx-check"></i></span><span v-if="item.vote_average > 0" class="poster-rating">{{ Number(item.vote_average).toFixed(1) }}</span></div>
          <div class="view-item-title">
            {{ item.title || item.name }}
          </div>
        </router-link>
      </div>
    </div>
    <n-empty v-if="!listLoading && !listError && !MediaDbInfo.length" description="当前媒体库暂无影片" class="catalog-empty" />
    <nav class="catalog-pagination" aria-label="列表翻页"><n-button @click="BackPage()" :disabled="listLoading || page <= 1" secondary>上一页</n-button><span>第 {{ page }} 页<span v-if="totalPages"> / {{ totalPages }}</span></span><n-button @click="NextPage()" :disabled="listLoading || !hasNextPage" secondary>下一页</n-button></nav>
    <n-modal v-model:show="showSort" transform-origin="center">
      <n-card style="width: 600px;" title="排序" :bordered="false" size="huge" role="dialog" aria-modal="true">
        <template #header-extra>
          <n-button @click="showSort = !showSort" strong secondary circle>
            <i class='bx bx-x'></i>
          </n-button>
        </template>
        <div class="sort-list">
          <div class="sort-title">
            排序方式
          </div>
          <div class="sort-list">
            <n-radio-group v-model:value="mode" name="radiogroup">
              <n-space vertical>
                <n-radio class="sort-item" v-for="item in modes"
                         :checked="mode === item.value" :key="item.value" :value="item.value">
                  {{ item.label }}
                </n-radio>
              </n-space>
            </n-radio-group>
          </div>
          <div class="sort-title">
            排序顺序
          </div>
          <div class="sort-list">
            <n-radio-group v-model:value="order" name="radiogroup">
              <n-space vertical>
                <n-radio class="sort-item" v-for="item in orders"
                         :checked="order === item.value" :key="item.value" :value="item.value">
                  {{ item.label }}
                </n-radio>
              </n-space>
            </n-radio-group>
          </div>
        </div>
      </n-card>
    </n-modal>
  </div>
</template>

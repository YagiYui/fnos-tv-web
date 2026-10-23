<script setup>
import MediaImage from "../../components/MediaImage.vue";
// 获取 Vue 实例
import {getCurrentInstance, onMounted, onBeforeUnmount, ref, computed, watch, inject, nextTick} from "vue";
import {useMediaDbData, useLibraryViews} from '@/store.js'
import {onBeforeRouteUpdate, onBeforeRouteLeave} from "vue-router";
import {emptyCatalogFilters, normalizeCatalogFilters, catalogTags, catalogTypeOptions, catalogFilterCount, catalogFilterSummary, loadCatalogFilterOptions, watchedOptions} from '../../catalog-filters.js';
import {listFavoriteMedia} from '../../media-actions.js';
import {libraryViewKey} from '../../navigation.js';

const MediaDbData = useMediaDbData()
const libraryViews = useLibraryViews();
const sortColumn = ref('create_time');
const sortType = ref('DESC');
const pageScroll = inject('pageScroll', {getTop: () => window.scrollY, scrollTo: top => window.scrollTo(0, top)});
const mediaChanges = inject('mediaChanges', ref(0));
const viewMediaRevision = ref(mediaChanges.value);

const guid = ref(null);
const isFavorites = computed(() => guid.value === '@favorites');
const libraryTitle = computed(() => isFavorites.value ? '收藏' : MediaDbData.list?.find(item => item.guid === guid.value)?.title || '媒体库');
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
const filters = ref(emptyCatalogFilters());
const draftFilters = ref(emptyCatalogFilters());
const draftMode = ref('create_time');
const draftOrder = ref('DESC');
const filterOptions = ref({genres: [], decades: []});
const filterOptionsLoading = ref(false);
const filterOptionsError = ref('');
let optionsController = null;
let optionsGeneration = 0;
let requestedPage = 1;
const libraryCategory = computed(() => isFavorites.value ? '' : MediaDbData.list?.find(item => item.guid === guid.value)?.category || proxy.$route.query.gallery_type);
const typeOptions = computed(() => catalogTypeOptions(libraryCategory.value));
const filterCount = computed(() => catalogFilterCount(filters.value));
const filterSummary = computed(() => catalogFilterSummary(filters.value, filterOptions.value));
const genreOptions = computed(() => {
  const selected = draftFilters.value.genres;
  return selected === null || filterOptions.value.genres.some(item => item.value === selected) ? filterOptions.value.genres
    : [{value: selected, label: `已选题材 #${selected}`}, ...filterOptions.value.genres];
});
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
const resultKey = ref('');
let viewAccount = null;
const resultsMatch = computed(() => resultKey.value === queryKey() && viewMediaRevision.value === mediaChanges.value);
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


function queryKey() { return JSON.stringify([guid.value, mode.value, order.value, page.value, normalizeCatalogFilters(filters.value)]); }
function cancelFilterOptions() { optionsGeneration++; optionsController?.abort(); optionsController = null; filterOptionsLoading.value = false; }
async function getFilterOptions() {
  cancelFilterOptions();
  const generation = optionsGeneration;
  const id = guid.value, account = viewAccount;
  const requestController = optionsController = new AbortController();
  const current = () => generation === optionsGeneration && !requestController.signal.aborted && id === guid.value && account === COMMON.userKey && account === viewAccount;
  filterOptionsLoading.value = true; filterOptionsError.value = '';
  try {
    const result = await loadCatalogFilterOptions(COMMON.requests, isFavorites.value ? null : id, libraryCategory.value, requestController.signal, {favorites: isFavorites.value});
    if (!current()) return;
    filterOptions.value = {genres: result.genres, decades: result.decades};
    filterOptionsError.value = result.warning;
  } catch (error) { if (current()) filterOptionsError.value = error?.message || '筛选选项加载失败，请重试'; }
  finally { if (current()) { filterOptionsLoading.value = false; optionsController = null; } }
}
function openSort() {
  draftFilters.value = normalizeCatalogFilters(filters.value);
  draftMode.value = mode.value; draftOrder.value = order.value;
  showSort.value = true;
  void getFilterOptions();
}
function closeSort() { showSort.value = false; cancelFilterOptions(); }
function resetDraft() { draftFilters.value = emptyCatalogFilters(); draftMode.value = 'create_time'; draftOrder.value = 'DESC'; }
async function applyFilters() {
  const generation = viewGeneration;
  cancelPending();
  applyingView = true;
  filters.value = normalizeCatalogFilters(draftFilters.value);
  mode.value = modes.some(item => item.value === draftMode.value) ? draftMode.value : 'create_time';
  order.value = ['ASC', 'DESC'].includes(draftOrder.value) ? draftOrder.value : 'DESC';
  closeSort();
  await nextTick();
  if (generation !== viewGeneration) return;
  applyingView = false;
  await GetMediaDbInfos(1);
}
function cancelPending() {
  listGeneration++;
  controller?.abort();
  controller = null;
  listLoading.value = false;
}
function saveView() {
  const hasData = resultsMatch.value;
  libraryViews.save(viewAccount, guid.value, {mode: mode.value, order: order.value,
    filters: normalizeCatalogFilters(filters.value), filterOptions: filterOptions.value,
    page: hasData ? page.value : 1, size: size.value, total: hasData ? total.value : null,
    items: hasData ? MediaDbInfo.value : [], hasData, scrollY: hasData ? pageScroll.getTop() : 0});
}
async function loadLibrary(id) {
  const generation = ++viewGeneration;
  cancelPending();
  closeSort();
  viewAccount = COMMON.userKey;
  viewMediaRevision.value = mediaChanges.value;
  guid.value = typeof id === 'string' ? id : '';
  if (!guid.value) { MediaDbInfo.value = []; resultKey.value = ''; listError.value = '请选择有效的媒体库'; return; }
  const saved = libraryViews.get(viewAccount, guid.value);
  applyingView = true;
  mode.value = saved?.mode || 'create_time';
  order.value = saved?.order || 'DESC';
  filters.value = normalizeCatalogFilters(saved?.filters);
  filterOptions.value = saved?.filterOptions || {genres: [], decades: []};
  filterOptionsError.value = '';
  page.value = saved?.page || 1;
  requestedPage = page.value;
  MediaDbInfo.value = saved?.items || [];
  total.value = saved?.total ?? null;
  resultKey.value = saved?.hasData ? queryKey() : '';
  listLoading.value = true;
  await nextTick();
  if (generation !== viewGeneration) return;
  applyingView = false;
  if (saved?.hasData) pageScroll.scrollTo(saved.scrollY);
  // Revalidate the saved page, keeping a restored page usable during a slow refresh.
  await GetMediaDbInfos(page.value, saved?.hasData ? {preserveScroll: true} : {scrollTop: saved?.scrollY || 0});
}
async function GetMediaDbInfos(targetPage = requestedPage, {preserveScroll = false, scrollTop = 0} = {}) {
  controller?.abort();
  const requestController = controller = new AbortController();
  const account = COMMON.userKey;
  const changeRevision = mediaChanges.value;
  const generation = ++listGeneration;
  const isCurrent = () => generation === listGeneration && !requestController.signal.aborted && account === COMMON.userKey && account === viewAccount && changeRevision === mediaChanges.value;
  listLoading.value = true;
  listError.value = '';
  requestedPage = targetPage;
  const request = {
    ancestor_guid: guid.value,
    tags: catalogTags(filters.value),
    exclude_grouped_video: 1,
    page: targetPage,
    page_size: size.value,
    sort_type: order.value,
    sort_column: mode.value
  };
  try {
    const res = isFavorites.value ? await listFavoriteMedia(COMMON.requests, {page: targetPage, pageSize: size.value,
      sortColumn: mode.value, sortType: order.value, filters: filters.value, signal: requestController.signal})
      : await COMMON.requests('POST', '/api/v1/item/list', true, request, {signal: requestController.signal});
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
    viewMediaRevision.value = changeRevision;
    resultKey.value = queryKey();
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
  if (listLoading.value || !resultsMatch.value || page.value <= 1) return;
  await GetMediaDbInfos(page.value - 1);
}
async function NextPage() {
  if (listLoading.value || !resultsMatch.value || !hasNextPage.value) return;
  await GetMediaDbInfos(page.value + 1);
}
watch([mode, order, () => JSON.stringify(filters.value)], () => { if (!applyingView) void GetMediaDbInfos(1); });
onBeforeRouteUpdate(to => {
  if (libraryViewKey(to) !== guid.value) { saveView(); viewGeneration++; cancelPending(); closeSort(); }
});
watch(() => libraryViewKey(proxy.$route), id => { void loadLibrary(id); });
watch(() => mediaChanges.value, () => {
  if (!guid.value) return;
  cancelPending(); resultKey.value = '';
  void GetMediaDbInfos(page.value, {preserveScroll: true});
});
onBeforeRouteLeave(() => { saveView(); viewGeneration++; cancelPending(); closeSort(); });
onBeforeUnmount(() => { viewGeneration++; cancelPending(); cancelFilterOptions(); });
onMounted(async () => { await loadLibrary(libraryViewKey(proxy.$route)); });
</script>

<template>

  <div class="content catalog-page">
    <div class="library-toolbar list-toolbar">
      <div><h1>{{ libraryTitle }}</h1><p class="page-description"><span v-if="total !== null">{{ total }} 部影片 · </span>第 {{ page }} 页<span v-if="totalPages"> / 共 {{ totalPages }} 页</span><span v-if="listLoading"> · 加载中</span></p></div>
      <div class="catalog-actions">
        <n-button @click="openSort" secondary><template #icon><i class="bx bx-sort-alt-2"></i></template>筛选与排序<span v-if="filterCount">（{{ filterCount }}）</span></n-button>
        <n-button @click="BackPage()" :disabled="listLoading || !resultsMatch || page <= 1" aria-label="上一页" title="上一页" secondary circle><i class="bx bx-chevron-left"></i></n-button>
        <n-button @click="NextPage()" :disabled="listLoading || !resultsMatch || !hasNextPage" aria-label="下一页" title="下一页" secondary circle><i class="bx bx-chevron-right"></i></n-button>
      </div>
    </div>
    <p v-if="filterCount" class="page-description" aria-label="已应用筛选">筛选：{{ filterSummary }}</p>
    <p v-if="MediaDbInfo.length && !resultsMatch" class="page-description" role="status">{{ listLoading ? '正在应用新条件，暂显示上次结果…' : '新条件尚未加载成功，当前显示上次结果；请重试或调整条件。' }}</p>
    <n-alert v-if="listError" type="error" style="margin-bottom: 16px">{{ listError }} <n-button text @click="GetMediaDbInfos()">重试</n-button></n-alert>
    <div class="card-show-content view-card-list" :aria-busy="listLoading">
      <div class="view-item poster-card" v-for="item in MediaDbInfo" :key="item.guid">
        <router-link :to="{
                    path: '/video', query: {
                        guid: item.guid,
                        gallery_type: item.type
                    }
                }">
          <div class="poster-art"><MediaImage :src="item.poster ? COMMON.imgUrl + '/92/17/' + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title || item.name" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span><span v-if="item.played" class="poster-watched"><i class="bx bx-check"></i></span><span v-if="item.vote_average > 0" class="poster-rating">{{ Number(item.vote_average).toFixed(1) }}</span></div>
          <div class="view-item-title">
            {{ item.title || item.name }}
          </div>
        </router-link>
      </div>
    </div>
    <n-empty v-if="!listLoading && !listError && !MediaDbInfo.length" :description="filterCount ? '没有符合当前筛选条件的影片' : isFavorites ? '暂无收藏影片' : '当前媒体库暂无影片'" class="catalog-empty" />
    <nav class="catalog-pagination" aria-label="列表翻页"><n-button @click="BackPage()" :disabled="listLoading || !resultsMatch || page <= 1" secondary>上一页</n-button><span>第 {{ page }} 页<span v-if="totalPages"> / {{ totalPages }}</span></span><n-button @click="NextPage()" :disabled="listLoading || !resultsMatch || !hasNextPage" secondary>下一页</n-button></nav>
    <n-modal :show="showSort" @update:show="value => { if (!value) closeSort(); }" transform-origin="center">
      <n-card class="catalog-filter-card" title="筛选与排序" :bordered="false" size="large" role="dialog" aria-modal="true" aria-label="筛选与排序">
        <template #header-extra><n-button @click="closeSort" quaternary circle aria-label="关闭筛选与排序"><i class="bx bx-x"></i></n-button></template>
        <p class="page-description">调整后点击应用；关闭面板不会改变当前列表。重置会还原面板中的筛选与排序。</p>
        <p v-if="filterOptionsLoading" role="status" class="page-description">正在加载片库筛选选项…</p>
        <n-alert v-if="filterOptionsError" type="warning" class="filter-options-alert">{{ filterOptionsError }} <n-button text :loading="filterOptionsLoading" @click="getFilterOptions">重试</n-button></n-alert>
        <div class="catalog-filter-form">
          <div><label id="catalog-type-label">媒体类型</label><n-select v-model:value="draftFilters.type" :options="[{value: '', label: '全部类型'}, ...typeOptions]" clearable placeholder="全部类型" aria-labelledby="catalog-type-label" /></div>
          <div><label id="catalog-genre-label">题材</label><n-select v-model:value="draftFilters.genres" :options="genreOptions" clearable filterable :loading="filterOptionsLoading" placeholder="全部题材" aria-labelledby="catalog-genre-label" /></div>
          <div><label id="catalog-decade-label">年代</label><n-select v-model:value="draftFilters.decade" :options="[{value: '', label: '全部年代'}, ...filterOptions.decades]" clearable :loading="filterOptionsLoading" placeholder="全部年代" aria-labelledby="catalog-decade-label" /></div>
          <div><label id="catalog-watched-label">观看状态</label><n-select v-model:value="draftFilters.watched" :options="[{value: '', label: '全部状态'}, ...watchedOptions]" clearable placeholder="全部状态" aria-labelledby="catalog-watched-label" /></div>
          <div><label id="catalog-sort-label">排序方式</label><n-select v-model:value="draftMode" :options="modes" aria-labelledby="catalog-sort-label" /></div>
          <div><label id="catalog-order-label">排序顺序</label><n-select v-model:value="draftOrder" :options="orders" aria-labelledby="catalog-order-label" /></div>
        </div>
        <template #footer><div class="catalog-filter-actions"><n-button @click="resetDraft" aria-label="重置面板中的筛选与排序">重置</n-button><span></span><n-button @click="closeSort">取消</n-button><n-button type="primary" @click="applyFilters">应用</n-button></div></template>
      </n-card>
    </n-modal>
  </div>
</template>

<style scoped>
.catalog-filter-card{width:min(600px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow-y:auto}
.catalog-filter-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 18px;padding:12px 0}
.catalog-filter-form label{display:block;font-size:13px;margin-bottom:8px;color:var(--cinema-muted)}
.catalog-filter-actions{display:flex;align-items:center;gap:10px}.catalog-filter-actions>span{flex:1}.filter-options-alert{margin:12px 0}
@media(max-width:480px){.catalog-filter-form{grid-template-columns:minmax(0,1fr);gap:14px}}
</style>

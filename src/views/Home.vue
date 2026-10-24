<script setup>
import HomeCarousel from "../components/HomeCarousel.vue";
import VisibleSection from '../components/VisibleSection.vue';
import MediaImage from '../components/MediaImage.vue';
import {continuePlaybackRoute} from './Play/player-presentation.js';
import {useMediaDbData, useMediaSearch, useBrowseSnapshots} from '../store'
import {getCurrentInstance, onMounted, ref, onUnmounted, computed, h, watch, inject, nextTick} from "vue";
import {onBeforeRouteLeave, RouterLink} from 'vue-router';
import {groupSearchResults, searchResultRoute} from '../media-search.js';
import {useMessage, NIcon, NProgress} from 'naive-ui'

const MediaDbData = useMediaDbData()
const message = useMessage()
const isMobile = ref(window.innerWidth <= 768);
const per_view = ref(window.innerWidth <= 768 ? 2 : 4);
const per_card = ref(window.innerWidth <= 768 ? 3 : 7);
const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
const browseSnapshots = useBrowseSnapshots();
let viewAccount = browseSnapshots.account ?? COMMON.userKey;
let viewRevision = browseSnapshots.revision;
let savedHome = browseSnapshots.get(viewAccount, 'home');
let playController = null;
let playGeneration = 0;
function cancelPlayList() { playGeneration++; playController?.abort(); playController = null; }
function saveHome() {
  browseSnapshots.save(viewAccount, 'home', {playList: playList.value, scrollY: pageScroll.getTop()}, viewRevision);
}
const mediaSearch = useMediaSearch();
const search = mediaSearch.state;
const keyword = ref(search.query);
const pageScroll = inject('pageScroll', {getTop: () => window.scrollY, scrollTo: top => window.scrollTo(0, top)});
const loadHomeLibrary = inject('loadHomeLibrary', () => {});
const cancelHomeLibraries = inject('cancelHomeLibraries', () => {});
const mediaChanges = inject('mediaChanges', ref(0));
const visibleIds = new Set();
function showLibrary(id) { visibleIds.add(id); return loadHomeLibrary(id); }
watch(() => mediaChanges.value, () => {
  if (search.query) void mediaSearch.submit(COMMON.requests, search.query, {preserve: true});
  else for (const id of visibleIds) void loadHomeLibrary(id, true);
  void GetPlayList().catch(error => message.error(error?.message || '继续观看加载失败'));
});
const searchGroups = computed(() => groupSearchResults(search.items, search.limit));
const hasMoreSearchResults = computed(() => searchGroups.value.some(group => group.total > group.items.length));
const visibleLibraries = computed(() => (MediaDbData.list || []).filter(item => item.category !== 'Others'));
const libraryRoute = item => ({path: '/list', query: {gallery_uid: item.guid, gallery_type: item.category}});

function filteredItems(key) {
  return MediaDbData.info[key]?.list || [];
}
async function submitSearch(event) {
  if (event?.isComposing) return;
  pageScroll.scrollTo(0);
  await mediaSearch.submit(COMMON.requests, keyword.value);
}
function clearSearch() {
  keyword.value = '';
  mediaSearch.clear();
  pageScroll.scrollTo(0);
}
function searchHistory(value) { keyword.value = value; return submitSearch(); }
watch(keyword, value => { if (!value.trim() && search.query) clearSearch(); });
watch(() => search.query, value => { if (!value) keyword.value = ''; else cancelHomeLibraries(); });
onBeforeRouteLeave(() => {
  saveHome();
  cancelPlayList();
  search.scrollY = pageScroll.getTop();
  mediaSearch.cancel();
  cancelHomeLibraries();
});
const playList = ref(savedHome?.playList || null)
const play_item_guid = ref(null);
const showDropdown = ref(false)
const dropdownX = ref(0)
const dropdownY = ref(0)
const currentContextItem = ref(null)

// 渲染图标的函数
const renderIcon = (icon) => {
  return () => h(NIcon, null, {default: () => icon})
}

// 右键菜单选项
const dropdownOptions = [
  {
    label: '继续播放',
    key: 'continue',
    icon: renderIcon('▶')
  },
  {
    label: '从继续观看中移除',
    key: 'remove',
    icon: renderIcon('🗑')
  }
]

// 处理右键菜单点击
const handleContextMenu = (e, item) => {
  e.preventDefault()
  currentContextItem.value = item
  dropdownX.value = e.clientX
  dropdownY.value = e.clientY
  showDropdown.value = true
}

// 处理菜单选项点击
const handleDropdownSelect = async (key) => {
  const item = currentContextItem.value
  if (!item) return

  switch (key) {
    case 'continue':
      // 跳转到播放页面
      proxy.$router.push(continuePlaybackRoute(item))
      break
    case 'remove':
      try {
        // 调用移除API
        await COMMON.requests("DELETE", `/api/v1/play/record`, true, {
          "item_guid": item.guid
        })
        message.success('已从继续观看中移除')
        // 重新获取播放列表
        await GetPlayList()
      } catch (error) {
        message.error('移除失败')
      }
      break
  }
  showDropdown.value = false
}

// 点击其他地方关闭菜单
const handleClickOutside = () => {
  showDropdown.value = false
}

// 监听窗口大小变化
const updateCarouselLayout = () => {
  isMobile.value = window.innerWidth <= 768;
  per_view.value = window.innerWidth <= 768 ? 2 : 4;
  per_card.value = window.innerWidth <= 768 ? 3 : 7;
};
window.addEventListener('resize', updateCarouselLayout);

async function GetPlayList() {
  cancelPlayList();
  if (!viewAccount || viewAccount !== COMMON.userKey) return;
  const generation = playGeneration;
  const controller = playController = new AbortController();
  const current = () => generation === playGeneration && !controller.signal.aborted && viewAccount === COMMON.userKey && viewRevision === browseSnapshots.revision;
  try {
    const result = await COMMON.requests('GET', '/api/v1/play/list', true, {}, {signal: controller.signal});
    if (!current()) return;
    if (!Array.isArray(result)) throw new Error('继续观看数据无效');
    playList.value = result;
    saveHome();
  } catch (error) {
    if (current()) throw error;
  } finally { if (current()) playController = null; }
}
watch(() => browseSnapshots.revision, () => {
  cancelPlayList();
  viewAccount = browseSnapshots.account ?? COMMON.userKey ?? '';
  viewRevision = browseSnapshots.revision;
  savedHome = browseSnapshots.get(viewAccount, 'home');
  playList.value = savedHome?.playList || null;
  if (viewAccount && viewAccount === COMMON.userKey) void GetPlayList().catch(error => message.error(error?.message || '继续观看加载失败'));
}, {flush: 'sync'});

onMounted(async () => {
  // 添加全局点击事件监听
  document.addEventListener('click', handleClickOutside)
  if (search.query) {
    if (search.status === 'idle' || search.stale) void mediaSearch.submit(COMMON.requests, search.query, {preserve: true});
  }
  await nextTick();
  pageScroll.scrollTo(search.query ? search.scrollY : savedHome?.scrollY || 0);
  try { if (!playController) await GetPlayList(); } catch (error) { message.error(error?.message || '继续观看加载失败'); }
})

// 组件卸载时移除事件监听
onUnmounted(() => {
  cancelPlayList();
  mediaSearch.cancel();
  cancelHomeLibraries();
  window.removeEventListener('resize', updateCarouselLayout);
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="content cinema-home">
    <div class="library-toolbar">
      <div><h1>首页</h1><p class="page-description">继续观看与媒体库</p></div>
      <n-input v-model:value="keyword" class="catalog-search" clearable placeholder="搜索全库，回车提交" aria-label="搜索全库" @keydown.enter="submitSearch" @clear="clearSearch">
        <template #prefix><i class="bx bx-search"></i></template>
        <template #suffix><n-button text :disabled="!keyword.trim()" aria-label="提交全库搜索" @click="submitSearch"><i class="bx bx-right-arrow-alt"></i></n-button></template>
      </n-input>
    </div>
    <section v-if="search.query" class="search-results" aria-label="搜索结果" :aria-busy="search.status === 'loading'">
      <p v-if="search.stale && search.items.length" class="page-description" role="status">正在重新验证状态，暂显示上次搜索结果。</p>
      <div class="section-heading"><h2>“{{ search.query }}” 的搜索结果</h2><n-button text @click="clearSearch">返回首页</n-button></div>
      <p v-if="search.status === 'loading'" role="status">正在搜索…</p>
      <n-alert v-else-if="search.status === 'error'" type="error">{{ search.error }} <n-button text @click="mediaSearch.submit(COMMON.requests, search.query)">重试</n-button></n-alert>
      <n-empty v-else-if="search.status === 'success' && !search.items.length" description="没有找到匹配的影片" class="catalog-empty" />
      <p v-if="search.status === 'success' && search.items.length" class="page-description">服务器返回 {{ search.items.length }} 项结果</p>
      <section v-for="group in searchGroups" :key="group.key" class="card-shows search-group">
        <div class="section-heading"><h2>{{ group.title }}</h2><span>{{ group.total }} 项</span></div>
        <div class="card-show-content view-card-list">
          <div v-for="item in group.items" :key="item.guid" class="view-item poster-card">
            <component :is="searchResultRoute(item) ? RouterLink : 'div'" :to="searchResultRoute(item) || undefined" class="search-result-link">
              <div class="poster-art"><MediaImage :src="item.poster ? COMMON.imgUrl + item.poster : '/images/not_video.jpg'" :alt="item.title" loading="lazy" /><span v-if="searchResultRoute(item)" class="poster-play"><i class="bx bx-play"></i></span><span v-if="Number(item.vote_average) > 0" class="poster-rating">{{ Number(item.vote_average).toFixed(1) }}</span><span v-if="Number(item.watched) > 0" class="poster-watched"><i class="bx bx-check"></i></span></div>
              <div class="view-item-title">{{ item.title }}</div>
              <div class="poster-caption">{{ item.ancestor_name }}<span v-if="item.release_date"> · {{ String(item.release_date).slice(0, 4) }}</span></div>
              <div v-if="!searchResultRoute(item)" class="poster-caption">{{ item.type }}：暂不支持打开此类型</div>
            </component>
          </div>
        </div>
      </section>
      <div v-if="hasMoreSearchResults" class="catalog-pagination"><n-button secondary @click="mediaSearch.showMore()">显示更多结果</n-button></div>
    </section>
    <template v-else>
    <div v-if="search.history.length" class="search-history" aria-label="搜索历史">
      <span>搜索历史</span><n-button v-for="value in search.history" :key="value" text @click="searchHistory(value)">{{ value }}</n-button><n-button text @click="mediaSearch.clearHistory()">清空历史</n-button>
    </div>
    <nav class="library-shortcuts" aria-label="媒体库">
      <router-link v-for="item in visibleLibraries" :key="item.guid" :to="libraryRoute(item)" class="library-shortcut">
        <i class="bx" :class="item.category === 'Movie' ? 'bx-film' : 'bx-tv'"></i><span>{{ item.title }}</span><i class="bx bx-chevron-right"></i>
      </router-link>
    </nav>
    <section class="card-shows continue-section" v-if="playList?.length">
      <div class="section-heading"><h2>继续观看</h2></div>
      <HomeCarousel :items="playList" :per-view="per_view" :mobile="isMobile">
        <template #default="{item}">
        <div class="continue-card" @contextmenu="handleContextMenu($event, item)">
          <router-link :to="continuePlaybackRoute(item)">
            <div class="continue-art"><MediaImage :src="item.poster ? COMMON.imgUrl + item.poster : '/images/not_gellery.png'" :alt="item.tv_title || item.title" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span>
              <div class="continue-progress" v-if="item.duration > 0"><span :style="{width: Math.min(100, Math.max(0, Number(item.ts || 0) / item.duration * 100)) + '%'}"></span></div>
            </div>
            <div class="view-item-title">{{ item.type === 'Episode' ? item.tv_title : item.title }}</div>
            <div class="poster-caption">{{ item.type === 'Episode' ? `第 ${item.season_number} 季 · 第 ${item.episode_number} 集` : '电影' }}</div>
          </router-link>
        </div>
      </template>
      </HomeCarousel>
    </section>
    <VisibleSection v-for="library in visibleLibraries" :key="library.guid" class="card-shows" :aria-busy="Boolean(MediaDbData.loading?.[library.guid])" @visible="showLibrary(library.guid)">
        <div class="section-heading"><h2>{{ library.title }}</h2><router-link :to="libraryRoute(library)" class="section-more">查看全部 <i class="bx bx-chevron-right"></i></router-link></div>
        <n-alert v-if="MediaDbData.errors?.[library.guid]" type="error">{{ MediaDbData.errors[library.guid] }} <n-button text :loading="Boolean(MediaDbData.loading?.[library.guid])" @click="loadHomeLibrary(library.guid, true)">重试</n-button></n-alert>
        <HomeCarousel v-if="filteredItems(library.guid).length" :items="filteredItems(library.guid)" :per-view="per_card" :mobile="isMobile">
          <template #default="{item}">
          <div class="view-item poster-card">
            <router-link :to="{path: '/video', query: {guid: item.guid, gallery_type: item.type}}">
              <div class="poster-art"><MediaImage :src="item.poster ? COMMON.imgUrl + '/92/17/' + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title || item.name" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span><span v-if="item.vote_average > 0" class="poster-rating">{{ Number(item.vote_average).toFixed(1) }}</span><span v-if="item.played" class="poster-watched"><i class="bx bx-check"></i></span></div>
              <div class="view-item-title">{{ item.title || item.name }}</div><div class="poster-caption" v-if="item.release_date">{{ String(item.release_date).slice(0, 4) }}</div>
            </router-link>
          </div>
        </template>
      </HomeCarousel>
      <n-empty v-else-if="MediaDbData.info[library.guid]" description="当前媒体库暂无影片" />
      <div v-else-if="!MediaDbData.errors?.[library.guid]" class="home-library-placeholder" :style="{'--home-columns': per_card}" aria-hidden="true"><div v-for="slot in per_card" :key="slot"><n-skeleton class="poster-art" /><n-skeleton text /></div></div>
    </VisibleSection>
    </template>
    <n-dropdown
        :show="showDropdown"
        :options="dropdownOptions"
        :x="dropdownX"
        :y="dropdownY"
        placement="bottom-start"
        trigger="manual"
        @select="handleDropdownSelect"
    />
  </div>
</template>

<style scoped>
.home-library-placeholder{display:grid;grid-template-columns:repeat(var(--home-columns),minmax(0,1fr));gap:18px}
.home-library-placeholder :deep(.poster-art){height:auto;aspect-ratio:2/3}.home-library-placeholder :deep(.n-skeleton--text){margin-top:10px}
</style>

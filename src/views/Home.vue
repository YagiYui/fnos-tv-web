<script setup>
import HomeCarousel from "../components/HomeCarousel.vue";
import {continuePlaybackRoute} from './Play/player-presentation.js';
import {useMediaDbData} from '../store'
import {getCurrentInstance, onMounted, ref, onUnmounted, computed, h} from "vue";
import {useMessage, NIcon, NProgress} from 'naive-ui'

const MediaDbData = useMediaDbData()
const message = useMessage()
const isMobile = ref(window.innerWidth <= 768);
const per_view = ref(window.innerWidth <= 768 ? 2 : 4);
const per_card = ref(window.innerWidth <= 768 ? 3 : 7);
const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
const keyword = ref('');
const visibleLibraries = computed(() => (MediaDbData.list || []).filter(item => item.category !== 'Others'));
const libraryInfo = key => (MediaDbData.list || []).find(item => item.guid === key);
const libraryRoute = item => ({path: '/list', query: {gallery_uid: item.guid, gallery_type: item.category}});

function filteredItems(key) {
  const needle = keyword.value.trim().toLowerCase();
  return (MediaDbData.info[key]?.list || []).filter(item => !needle || (item.title || item.name || '').toLowerCase().includes(needle));
}
const hasSearchResults = computed(() => Object.keys(MediaDbData.info).some(key => filteredItems(key).length));
const playList = ref(null)
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
  let api = "/api/v1/play/list"
  playList.value = await COMMON.requests("GET", api, true);
}

onMounted(async () => {
  await GetPlayList();
  // 添加全局点击事件监听
  document.addEventListener('click', handleClickOutside)
})

// 组件卸载时移除事件监听
onUnmounted(() => {
  window.removeEventListener('resize', updateCarouselLayout);
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="content cinema-home">
    <div class="library-toolbar">
      <div><h1>首页</h1><p class="page-description">继续观看与媒体库</p></div>
      <n-input v-model:value="keyword" class="catalog-search" clearable placeholder="搜索已载入影片" aria-label="搜索已载入影片">
        <template #prefix><i class="bx bx-search"></i></template>
      </n-input>
    </div>
    <nav class="library-shortcuts" aria-label="媒体库">
      <router-link v-for="item in visibleLibraries" :key="item.guid" :to="libraryRoute(item)" class="library-shortcut">
        <i class="bx" :class="item.category === 'Movie' ? 'bx-film' : 'bx-tv'"></i><span>{{ item.title }}</span><i class="bx bx-chevron-right"></i>
      </router-link>
    </nav>
    <n-empty v-if="keyword && !hasSearchResults" description="没有找到匹配的已载入影片" class="catalog-empty" />
    <section class="card-shows continue-section" v-if="playList?.length && !keyword">
      <div class="section-heading"><h2>继续观看</h2></div>
      <HomeCarousel :items="playList" :per-view="per_view" :mobile="isMobile">
        <template #default="{item}">
        <div class="continue-card" @contextmenu="handleContextMenu($event, item)">
          <router-link :to="continuePlaybackRoute(item)">
            <div class="continue-art"><img v-lazy="item.poster ? COMMON.imgUrl + item.poster : '/images/not_gellery.png'" :alt="item.tv_title || item.title" loading="lazy"><span class="poster-play"><i class="bx bx-play"></i></span>
              <div class="continue-progress" v-if="item.duration > 0"><span :style="{width: Math.min(100, Math.max(0, Number(item.ts || 0) / item.duration * 100)) + '%'}"></span></div>
            </div>
            <div class="view-item-title">{{ item.type === 'Episode' ? item.tv_title : item.title }}</div>
            <div class="poster-caption">{{ item.type === 'Episode' ? `第 ${item.season_number} 季 · 第 ${item.episode_number} 集` : '电影' }}</div>
          </router-link>
        </div>
      </template>
      </HomeCarousel>
    </section>
    <template v-for="key in Object.keys(MediaDbData.info)" :key="key">
      <section class="card-shows" v-if="libraryInfo(key)?.category !== 'Others' && filteredItems(key).length">
        <div class="section-heading"><h2>{{ libraryInfo(key)?.title || '媒体库' }}</h2><router-link v-if="libraryInfo(key)" :to="libraryRoute(libraryInfo(key))" class="section-more">查看全部 <i class="bx bx-chevron-right"></i></router-link></div>
        <HomeCarousel :items="filteredItems(key)" :per-view="per_card" :mobile="isMobile">
          <template #default="{item}">
          <div class="view-item poster-card">
            <router-link :to="{path: '/video', query: {guid: item.guid, gallery_type: item.type}}">
              <div class="poster-art"><img v-lazy="item.poster ? COMMON.imgUrl + '/92/17/' + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title || item.name" loading="lazy"><span class="poster-play"><i class="bx bx-play"></i></span><span v-if="item.vote_average > 0" class="poster-rating">{{ Number(item.vote_average).toFixed(1) }}</span><span v-if="item.played" class="poster-watched"><i class="bx bx-check"></i></span></div>
              <div class="view-item-title">{{ item.title || item.name }}</div><div class="poster-caption" v-if="item.release_date">{{ String(item.release_date).slice(0, 4) }}</div>
            </router-link>
          </div>
        </template>
      </HomeCarousel>
      </section>
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

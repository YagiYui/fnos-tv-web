<script setup>
import {computed, getCurrentInstance, onMounted, onBeforeUnmount, ref, watch} from 'vue'
import VueCookies from 'vue-cookies';
import {darkTheme} from "naive-ui";
import PageBack from './components/PageBack.vue';
import {isLibraryActive} from './navigation.js';
import {applyDocumentTheme, readThemePreference, isDarkTheme, themeModes} from './theme.js';
import {CatalogCache} from './catalog-cache.js';

import {useMediaDbData} from './store.js'
import {useRoute} from "vue-router";

const MediaDbData = useMediaDbData()
const catalogCache = new CatalogCache();
let initialization = null;
let initializedAccount = null;
let metadataUpdated = 0;
onBeforeUnmount(() => catalogCache.clear());

// 获取 Vue 实例
const instance = getCurrentInstance();
const COMMON = instance.appContext.config.globalProperties.$COMMON;
let UserInfo = ref({})
const avatarName = computed(() => String(UserInfo.value?.username || '').trim());
const avatarInitial = computed(() => Array.from(avatarName.value)[0]?.toLocaleUpperCase() || 'U');
let load = ref(true)
const title = ref(COMMON.title || 'FNOS TV');
let collapsed = ref(false);
const themePreference = ref(readThemePreference());
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(themeMedia.matches);
const dark = computed(() => isDarkTheme(themePreference.value, systemDark.value));
const theme = computed(() => dark.value ? darkTheme : null);
const themeOptions = [{label: '跟随系统', key: 'system'}, {label: '浅色模式', key: 'light'}, {label: '深色模式', key: 'dark'}];
const themeLabel = computed(() => themeOptions.find(o => o.key === themePreference.value)?.label);
function setThemePreference(mode) {
  if (!themeModes.includes(mode)) return;
  themePreference.value = mode;
  try { localStorage.setItem('fnosThemeMode', mode); } catch {}
}
const onSystemTheme = event => { systemDark.value = event.matches; };
themeMedia.addEventListener('change', onSystemTheme);
watch([themePreference, systemDark], () => applyDocumentTheme(themePreference.value, systemDark.value), {immediate: true});
onBeforeUnmount(() => themeMedia.removeEventListener('change', onSystemTheme));
const data = ref(null)
const MediaDbSum = ref({})
const MediaDbInfo = ref({})
const ConfigData = ref({})
const route = useRoute();
const pageLabel = computed(() => ({'/': '首页', '/list': data.value?.find(item => item.guid === route.query.gallery_uid)?.title || '媒体库', '/video': '影片详情', '/player': '正在播放'})[route.path] || '片库');
const themeOverrides = computed(() => ({common: {primaryColor: dark.value ? '#83b0f1' : '#3978d4', primaryColorHover: dark.value ? '#a4c6f5' : '#4f88da', primaryColorPressed: dark.value ? '#6598dc' : '#2866bb', borderRadius: '8px'}}));
const options = ref([
  {
    label: '注销登录',
    key: "out"
  },
])

if (COMMON.isMo) {
  collapsed.value = true;
}
const collapsedItem = VueCookies.get("collapsed");
if (collapsedItem === "true") {
  collapsed.value = true;
}

// 添加移动端检测
const isMobile = ref(window.innerWidth <= 768);

// 监听窗口大小变化
const onWindowResize = () => {
  isMobile.value = window.innerWidth <= 768;
  if (isMobile.value) {
    collapsed.value = true;
  }
};
window.addEventListener('resize', onWindowResize);
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize));

// 获取用户信息
async function GetUserInfo() {
  if (VueCookies.get('authorization') !== null) {
    let api = '/api/v1/user/info'
    UserInfo.value = await COMMON.requests("GET", api, true);
  }
}

async function getConfig() {
  let api = '/api/v1/sys/config'
  ConfigData.value = await COMMON.requests("GET", api);
  if (ConfigData.value !== undefined) {
    if (ConfigData.value.server_name) {
      title.value = ConfigData.value.server_name;
      localStorage.setItem("title", title.value);
    }
  }
}

async function GetMediaDbList() {
  let api = '/api/v1/mediadb/list'
  data.value = await COMMON.requests("GET", api, true);
  MediaDbData.list = data.value
}

async function GetMediaDbSum() {
  let api = '/api/v1/mediadb/sum'
  MediaDbSum.value = await COMMON.requests("GET", api, true);
}

async function GetMediaDbInfos() {
  await catalogCache.load(data.value, {
    account: initializedAccount,
    sortColumn: MediaDbData.sort_column, sortType: MediaDbData.sort_type,
    request: (payload, signal) => COMMON.requests('POST', '/api/v1/item/list', true, payload, {signal}),
    onData: (guid, result) => {
      MediaDbData.info[guid] = result;
      delete MediaDbData.errors[guid];
    },
    onError: (guid, error) => { MediaDbData.errors[guid] = error?.message || '媒体库加载失败，请进入媒体库重试'; }
  });
}


const reF = async () => {
  await onMountedFun();
};


// 修改 toggDrawer 函数
function toggDrawer() {
  if (isMobile.value) {
    // 在移动端时，点击菜单按钮显示/隐藏侧边栏
    collapsed.value = !collapsed.value;
  } else {
    // 在桌面端时，保持原有的折叠/展开行为
    collapsed.value = !collapsed.value;
    VueCookies.set("collapsed", collapsed.value);
  }
}

function Home() {
  instance.proxy.$router.push({
    path: "/",
  })
}

function toggDark() {
  setThemePreference(dark.value ? 'light' : 'dark');
}

function handleSelect(key) {
  if (key === "out") {
    catalogCache.clear();
    MediaDbData.info = {};
    MediaDbData.errors = {};
    VueCookies.remove("authorization");
    COMMON.ShowMsg("注销登录成功！")
    setTimeout(function () {
      location.reload();
    }, 1000)
  }
}

async function runFunByPath(path, fun) {
  if (route.path !== path) {
    await fun()
  }
}

async function onMountedFun() {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      await getConfig().catch(() => {});
      document.title = title.value;
      if (!VueCookies.get('authorization') || route.path === '/login') return;
      await GetUserInfo();
      const account = UserInfo.value?.guid || UserInfo.value?.uid || UserInfo.value?.username;
      if (!account) throw new Error('未获取到有效的用户信息');
      COMMON.userKey = String(account);
      const accountChanged = account !== initializedAccount;
      if (accountChanged) {
        catalogCache.clear();
        MediaDbData.info = {}; MediaDbData.errors = {};
      }
      if (accountChanged || Date.now() - metadataUpdated > 60000) {
        await Promise.all([GetMediaDbSum(), GetMediaDbList()]);
        if (route.path === '/login') return;
        initializedAccount = account;
        metadataUpdated = Date.now();
      }
      load.value = false;
      await GetMediaDbInfos();
    } catch (error) {
      COMMON.ShowMsg(error?.message || '加载失败，请刷新重试');
    } finally {
      load.value = false;
    }
  })();
  try { await initialization; } finally { initialization = null; }
}

onMounted(async () => {
  await onMountedFun();
})

// 监听路由变化
watch(
    () => route.fullPath,
    async (newPath, oldPath) => {
      if (route.path === '/login') {
        catalogCache.clear(); initializedAccount = null;
        MediaDbData.info = {}; MediaDbData.errors = {}; MediaDbData.list = [];
      }
      if (newPath === "/") {
        await onMountedFun();
      }
    }
);


</script>

<template>
  <div v-if="load" class="load"></div>
  <n-config-provider preflight-style-disabled=true :theme="theme" :theme-overrides="themeOverrides" v-else>
    <n-message-provider>
      <n-notification-provider>
        <n-dialog-provider>
          <n-layout v-if="route.path !== '/login'" :class='[dark ? "dark" : "light", "home", {watching: route.path === "/player"}]'>
            <n-layout-header bordered>
              <div class="header-content">
                <n-space>
                  <div @click="toggDrawer" class="menu-button">
                    <n-button circle>
                      <i class='bx bx-menu'></i>
                    </n-button>
                  </div>
                  <div @click="Home" class="title brand-title">
                    <span class="brand-mark"><i class="bx bxs-videos"></i></span>
                    <span>{{ title }}</span>
                  </div>
                  <span class="header-context">{{ pageLabel }}</span>
                </n-space>
                <n-space justify="end" class="header-right">
                  <n-dropdown trigger="click" :options="themeOptions" @select="setThemePreference">
                    <n-button quaternary round :title="'外观：' + themeLabel" aria-label="选择亮色或暗色模式">
                      <template #icon><i class="bx" :class="themePreference === 'system' ? 'bx-desktop' : dark ? 'bx-moon' : 'bx-sun'"></i></template>
                      <span class="theme-label">{{ themeLabel }}</span>
                    </n-button>
                  </n-dropdown>

                  <n-dropdown trigger="hover" placement="bottom-start" :options="options"
                              @select="handleSelect">
                    <n-avatar circle size="medium" class="user-avatar" :title="avatarName" :aria-label="avatarName ? '用户：' + avatarName : '用户菜单'">
                      {{ avatarInitial }}
                    </n-avatar>
                  </n-dropdown>
                </n-space>
              </div>
            </n-layout-header>
            <n-layout position="absolute" :style="{ top: '64px' }" has-sider>
              <n-layout-sider 
                :collapsed="collapsed" 
                collapse-mode="width" 
                :collapsed-width="0" 
                :width="216"
                :native-scrollbar="false" 
                bordered
                :show-collapsed-content="false"
                :class="{ 'mobile-sider': isMobile }"
              >
                <div class="sider-item">
                  <div class="sider-item-title">导航</div>
                  <div class="navigation">
                    <ul class="nav-links">
                      <li>
                        <router-link to="/" @click="isMobile && (collapsed = true)">
                                                    <span class="icon">
                                                        <i class='bx bx-home'></i>
                                                    </span>
                          <span class="title">首页</span>
                        </router-link>
                      </li>
                      <!--                      <li>-->
                      <!--                        <router-link to="/star">-->
                      <!--                                                    <span class="icon">-->
                      <!--                                                        <i class='bx bx-star'></i>-->

                      <!--                                                    </span>-->
                      <!--                          <span class="title">收藏</span>-->
                      <!--                        </router-link>-->
                      <!--                      </li>-->
                    </ul>
                  </div>
                </div>
                <div class="sider-item gallery-list">
                  <div class="sider-item-title">媒体库</div>
                  <div class="navigation more">
                    <ul class="nav-links">
                      <li v-for="(item, index) in data" :key="index">
                        <div v-if="item.category !== 'Others'">
                          <router-link @click="isMobile && (collapsed = true)" active-class="" exact-active-class="" :class="{'library-active': isLibraryActive(route, item.guid)}" :to="{
                                                    path: '/list', query: {
                                                        gallery_uid: item.guid,
                                                        gallery_type: item.category
                                                    }
                                                }">
                                                    <span v-if="item.category === 'Movie'" class="icon">
                                                        <i class='bx bxs-movie'></i>
                                                    </span>
                            <span v-else class="icon">
                                                        <i class='bx bx-desktop'></i>
                                                    </span>
                            <span :data-id="item.gallery_uid" class="title">{{ item.title }}</span>
                            <span class="library-count">{{
                                MediaDbSum[item.guid]
                              }}</span>
                          </router-link>
                        </div>
                      </li>
                    </ul>
                  </div>
                </div>
              </n-layout-sider>
              <n-layout :native-scrollbar="false" :class="{ 'mobile-content': isMobile }">
                <PageBack v-if="route.path === '/list'" />
                <router-view/>
              </n-layout>
            </n-layout>
          </n-layout>
          <router-view v-else/>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>

</template>

<style>
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  overflow-x: hidden;
  background-position: top left;
}

p {
  margin: 0;
  padding: 0;
}

ul li .title,
.sider-item-title {
  white-space: nowrap;
  font-size: 1.5em;
}


.load {
  position: absolute;
  top: 50%;
  left: 50%;
  border: 4px solid #2d8cf0;
  border-radius: 50%;
  border-bottom-color: transparent;
  z-index: 1;
  height: 100px;
  width: 100px;
  display: inline-block;
  animation: spin 1s linear infinite;
  margin-left: -50px;
  margin-top: -50px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.gallery-img {
  width: 100%;
  aspect-ratio: 355/200;
}

.title {
  font-size: 1.5em;
}

.content {
  padding: 12px;
}

a,
a:hover {
  text-decoration: none;
}

a {
  color: black;

}

.dark a {
  color: #fff;
}

.home {
  min-height: 100vh;
  width: -webkit-fill-available;
  font-family: -apple-system, BlinkMacSystemFont, Helvetica Neue, PingFang SC, Microsoft YaHei, Source Han Sans SC, Noto Sans CJK SC, WenQuanYi Micro Hei, sans-serif;
  font-size: 15px;
}

.n-layout-header {
  max-width: 100%;
  padding-left: 10px;
  padding-right: 10px;
  height: 60px;
  line-height: 60px;
  position: sticky;
  top: 0;
  z-index: 2;
}

.header-content {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

span.n-avatar {
  position: relative;
  top: 8px;
}

.navigation ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.navigation ul li {
  position: relative;
  list-style: none;
  width: 100%;
}

.navigation ul li:hover {
  background: rgba(0, 0, 0, .1);
}

.navigation ul li a {
  position: relative;
  width: 100%;
  display: flex;
  text-decoration: none;
  color: black;
  font-weight: 500;
}

.navigation ul {
  overflow: visible;
}

.navigation ul li a .icon i {
  position: relative;
  display: block;
  min-width: 80px;
  font-size: 26px;
  line-height: 65px;
  text-align: center;
}


.navigation ul li a .title {
  position: relative;
  display: block;
  height: 60px;
  line-height: 60px;
  white-space: nowrap;
  font-size: 1.3em;
}

.sider-item-title {
  font-size: 1.4em;
  font-weight: 400;
  padding: 20px;
}


.dark .navigation ul li a .title,
.dark .navigation ul li a .icon {
  color: hsla(0, 0%, 100%, .7);
}

.light .navigation ul li a .title,
.light .navigation ul li a .icon {
  color: black;
}

.dark .navigation ul li:hover,
.light .navigation ul li:hover {
  background: rgba(0, 0, 0, .1);
}

.dark .navigation ul li a.active {
  background-color: #2d8cf0 !important;
}

.light .navigation ul li a.active .title,
.light .navigation ul li a.active .icon {
  color: #2d8cf0 !important;
}

.light .navigation.more ul li a.active .title,
.light .navigation.more ul li a.active .icon {
  display: block;
  color: black;
}

.n-layout-footer {
  text-align: center;
}

/* 移动端适配样式 */
@media (max-width: 768px) {
  .n-layout-header {
    padding: 0 10px;
    height: 50px;
    line-height: 50px;
  }

  .header-content {
    align-items: center;
  }

  .title {
    font-size: 1.2em;
  }

  .menu-button {
    display: block;
  }

  .header-right {
    gap: 8px;
  }

  .n-avatar {
    width: 32px !important;
    height: 32px !important;
    font-size: 14px !important;
  }

  .mobile-sider {
    position: fixed;
    top: 50px;
    left: 0;
    height: calc(100vh - 50px);
    z-index: 1000;
    transition: transform 0.3s ease;
    background-color: var(--n-color);
  }

  .mobile-sider.n-layout-sider--collapsed {
    transform: translateX(-100%);
  }

  /* 修改遮罩层样式 */
  .mobile-sider::before {
    content: '';
    position: fixed;
    top: 50px;
    left: 0;
    right: 0;
    bottom: 0;
    background: transparent; /* 移除背景色 */
    z-index: -1;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  .mobile-sider:not(.n-layout-sider--collapsed)::before {
    opacity: 1;
    pointer-events: auto; /* 保持点击阻止功能 */
  }

  .mobile-content {
    margin-left: 0 !important;
  }

  .navigation ul li a .icon i {
    min-width: 50px;
    font-size: 20px;
    line-height: 50px;
  }

  .navigation ul li a .title {
    height: 50px;
    line-height: 50px;
    font-size: 1.1em;
  }

  .sider-item-title {
    font-size: 1.2em;
    padding: 15px;
  }

  .content {
    padding: 8px;
  }

  /* 优化下拉菜单在移动端的显示 */
  .n-dropdown-menu {
    max-width: 200px;
  }

  .n-dropdown-option {
    padding: 8px 12px;
    font-size: 14px;
  }
}

/* 小屏幕手机适配 */
@media (max-width: 480px) {
  .n-layout-header {
    padding: 0 8px;
  }

  .title {
    font-size: 1.1em;
  }

  .n-button {
    padding: 0 8px;
  }

  .n-avatar {
    width: 28px !important;
    height: 28px !important;
    font-size: 12px !important;
  }

  .navigation ul li a .icon i {
    min-width: 40px;
    font-size: 18px;
  }

  .navigation ul li a .title {
    font-size: 1em;
  }

  .sider-item-title {
    font-size: 1.1em;
    padding: 12px;
  }
}

/* 优化滚动条 */
.n-layout-sider {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

.n-layout-sider::-webkit-scrollbar {
  width: 4px;
}

.n-layout-sider::-webkit-scrollbar-track {
  background: transparent;
}

.n-layout-sider::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
}

.dark .n-layout-sider::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
}
</style>

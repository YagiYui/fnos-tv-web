<script setup>
import flvjs from 'flv.js';
import Hls from 'hls.js';
import {computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch} from "vue";

import Artplayer from "./ArtPlayer.vue";
import {onBeforeRouteLeave, onBeforeRouteUpdate} from "vue-router";
import VueCookies from "vue-cookies";
import sortedIndexBy from 'lodash-es/sortedIndexBy'
import artplayerPluginDanmuku from "artplayer-plugin-danmuku";
import axios from "axios";
import {createBlobVTTUrl, SegmentedSubtitleLoader, subtitleOptions, bindSubtitleTrack, subtitleSearchResults, downloadSubtitle, isPgsSubtitle, streamSubtitleGuid} from "./subtitle.js"
import {episodeDanmaku, errorText} from '../../compat.js';
import {SubtitleOverlay, waitForAssSubtitle} from './ass-renderer.js';
import {playbackTitle, playbackSelection, nextEpisode} from './player-presentation.js';
import {renderDanmaku} from './danmaku-renderer.js';
import {PlaybackSession, createProgressReporter} from './playback-session.js';
import {loadPlaybackMetadata, primaryMediaFile} from './playback-metadata.js';
import {chooseAudio, audioLabel, readPlayerPreference, writePlayerPreference, createAutoplayCountdown} from './audio-tracks.js';
const playbackSession = new PlaybackSession();
import {installMobileFullscreen} from './mobile-fullscreen.js';
import {installMobileDanmaku} from './mobile-danmaku.js';
import {backIcon, fullscreenIcon, fullscreenExitIcon} from './player-icons.js';
import {exitPlayerFullscreen, installMobileGestures, installPlaybackNoticeFilter} from './player-interactions.js';
let disposeMobileGestures = () => {};
let disposePlaybackNotices = () => {};
import {installDesktopIdle} from './desktop-idle.js';
let disposeDesktopIdle = () => {};
import {externalPlayerLink, externalPlaylist} from './external-player.js';
import {replaceMediaEngine, releaseMediaEngine} from './media-lifecycle.js';
let disposeMobileDanmaku = () => {};
const touchPlayer = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
let disposeMobileFullscreen = () => {};

const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
const device = proxy.$device;
const currentAudio = ref(null);
const preferredAudioLanguage = ref(readPlayerPreference(localStorage, COMMON.userKey, 'audioLanguage', ''));
const autoPlayNext = ref(readPlayerPreference(localStorage, COMMON.userKey, 'autoPlayNext', true));
const stopAfterCurrent = ref(false);
let autoplayPanel = null, autoplayText = null;
const autoplayCountdown = createAutoplayCountdown(remaining => {
  if (!art) return;
  if (remaining === null) { if (autoplayPanel) autoplayPanel.hidden = true; return; }
  if (!autoplayPanel) {
    autoplayPanel = document.createElement('div');
    autoplayPanel.className = 'fnos-autoplay-countdown';
    autoplayPanel.style.cssText = 'position:absolute;bottom:72px;right:16px;padding:12px;background:#111d;color:white;border-radius:8px;pointer-events:auto';
    autoplayText = document.createElement('span');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消下一集';
    cancel.addEventListener('click', event => {event.stopPropagation();autoplayCountdown.cancel();});
    autoplayPanel.append(autoplayText, cancel);
    art.layers.add({name: 'autoplay-countdown', html: autoplayPanel});
  }
  autoplayPanel.hidden = false;
  autoplayText.textContent = `${remaining} 秒后播放下一集 `;
}, () => play_next());

let art = null;
const guid = ref(null);
const episode_guid = ref(null);
const gallery_type = ref(null);
const EpisodeList = ref(null);
const StreamList = ref(null);
const QualityData = ref(null);
const playInfo = ref(null);
async function backFromPlayer() {
  if (exitPlayerFullscreen(art)) return;
  art?.pause();
  const previous = window.history.state?.back;
  if (typeof previous === 'string' && previous.startsWith('/') && !previous.startsWith('//') && !/^\/(player|login)(?:[/?#]|$)/.test(previous)) {
    proxy.$router.back();
  } else if (guid.value) {
    await proxy.$router.replace({path: '/video', query: {guid: guid.value, gallery_type: gallery_type.value}});
  } else {
    await proxy.$router.replace('/');
  }
}
let playerHeading = null;
function createPlayerHeading() {
  if (playerHeading) {
    playerHeading.querySelector('.art-title').textContent = playbackTitle(playInfo.value, gallery_type.value);
    return playerHeading;
  }
  const heading = document.createElement('div');
  heading.className = 'art-player-heading';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'art-back-button';
  back.setAttribute('aria-label', '返回；全屏时退出全屏');
  back.title = '返回；全屏时退出全屏';
  back.innerHTML = backIcon;
  back.addEventListener('click', event => {event.stopPropagation(); void backFromPlayer();});
  const title = document.createElement('span');
  title.className = 'art-title';
  title.textContent = playbackTitle(playInfo.value, gallery_type.value);
  heading.append(back, title);
  playerHeading = heading;
  return heading;
}

function mountPlayerHeading(player) {
  const heading = createPlayerHeading();
  if (!player.layers.title) player.layers.add({
    name: 'title', html: heading,
    style: {position: 'absolute', top: '10px', left: '10px', color: '#fff',
      fontSize: '16px', backgroundColor: 'transparent', padding: '4px 8px'},
  });
}

const showModal = ref(false);
const externalMediaUrl = ref('');
const externalBusy = ref(false);
const externalError = ref('');
const externalPlaylistUrl = ref('');
function releaseExternalPlaylist() {
  if (externalPlaylistUrl.value) URL.revokeObjectURL(externalPlaylistUrl.value);
  externalPlaylistUrl.value = '';
}
watch(externalMediaUrl, value => {
  releaseExternalPlaylist();
  if (value) externalPlaylistUrl.value = URL.createObjectURL(new Blob([externalPlaylist(value, playInfo.value?.title)], {type: 'audio/x-mpegurl'}));
});
watch(showModal, visible => { if (!visible) externalMediaUrl.value = ''; });
const externalHref = player => externalPlayerLink(player, externalMediaUrl.value, navigator.userAgent);
async function openExternalPlayback() {
  if (externalBusy.value) return;
  art?.pause();
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  showModal.value = true;
  externalMediaUrl.value = '';
  externalError.value = '';
  externalBusy.value = true;
  const episode = episode_guid.value;
  try {
    if (use_302_play.value && url.value !== COMMON.fnHost + urlBase.value) {
      const direct = new URL(playUrl.value, window.location.origin);
      if (!['http:', 'https:'].includes(direct.protocol)) throw new Error('无效的媒体地址');
      externalMediaUrl.value = direct.href;
      return;
    }
    const response = await axios.post('/danmu/external-play', {play_link: urlBase.value}, {
      headers: {Authorization: VueCookies.get('authorization') || ''}
    });
    if (episode !== episode_guid.value || !showModal.value) return;
    if (response.data?.code !== 0 || !response.data.data?.url) throw new Error(response.data?.msg || '外部播放链接获取失败');
    externalMediaUrl.value = new URL(response.data.data.url, window.location.origin).href;
  } catch (error) {
    externalError.value = error.response?.data?.msg || errorText(error);
  } finally { externalBusy.value = false; }
}

const loading = ref(true);
const urlBase = ref(null);
const url = ref(null);
const playUrl = ref(null);
const skipList = ref([])
const seasonConfig = ref({})
const showSetUp = ref(false)
const timerSendPlayRecord = ref(null);
const emojos = ref(null);
const allDanmaku = ref({})
const showDanmakuSearch = ref(false);
const danmakuKeyword = ref('');
const danmakuSearchSource = ref('360');
const danmakuResults = ref([]);
const danmakuEpisodes = ref([]);
const danmakuSelectedEpisode = ref(null);
const danmakuSelectedSource = ref(null);
const danmakuBusy = ref(false);
const danmakuSearchDone = ref(false);
const danmakuSearchError = ref('');
let danmakuLoadGeneration = 0;
let lastDanmuLoadedUntil = -1;
const danmakuEpisodeOptions = computed(() => danmakuEpisodes.value.map((e, index) => ({
  value: index, label: `${e.number ? `第 ${e.number} 集 · ` : ''}${e.title}`
})));
async function danmakuRequest(path, options = {}) {
  const response = await fetch(path, {...options, headers: {
    Authorization: VueCookies.get('authorization') || '',
    ...(options.body ? {'Content-Type': 'application/json'} : {})
  }});
  const data = await response.json();
  if (!response.ok || (data?.code !== undefined && data.code !== 0))
    throw new Error(data?.msg || `弹幕服务返回 HTTP ${response.status}`);
  return data;
}
function openDanmakuSearch() {
  art?.pause();
  if (art) art.setting.show = false;
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  danmakuKeyword.value = playInfo.value?.tv_title || playInfo.value?.title || '';
  showDanmakuSearch.value = true;
}
async function searchDanmaku() {
  if (danmakuBusy.value) return;
  const episodeGuid = episode_guid.value;
  danmakuBusy.value = true;
  danmakuSearchError.value = '';
  danmakuSearchDone.value = false;
  danmakuEpisodes.value = [];
  danmakuSelectedSource.value = null;
  try {
    const data = await danmakuRequest('/danmu/search?' + new URLSearchParams({
      keyword: danmakuKeyword.value.trim(), source: danmakuSearchSource.value
    }));
    if (episodeGuid !== episode_guid.value) return;
    danmakuResults.value = data.results || [];
    danmakuSearchDone.value = true;
  } catch (error) { if (episodeGuid === episode_guid.value) danmakuSearchError.value = errorText(error); }
  finally { danmakuBusy.value = false; }
}
async function chooseDanmakuSource(source) {
  if (danmakuBusy.value) return;
  const episodeGuid = episode_guid.value;
  danmakuBusy.value = true;
  danmakuSearchError.value = '';
  danmakuEpisodes.value = [];
  danmakuSelectedSource.value = source;
  try {
    const data = await danmakuRequest('/danmu/episodes?' + new URLSearchParams({url: source.url}));
    if (episodeGuid !== episode_guid.value) return;
    danmakuEpisodes.value = data.episodes || [];
    const matched = danmakuEpisodes.value.findIndex(e => String(e.number) === String(playInfo.value.episode_number ?? 1));
    danmakuSelectedEpisode.value = matched < 0 ? 0 : matched;
  } catch (error) { if (episodeGuid === episode_guid.value) danmakuSearchError.value = errorText(error); }
  finally { danmakuBusy.value = false; }
}
async function applyDanmakuRows(rows, episodeNumber) {
  // load() 不带参数会清空旧队列；带数组则是追加，不能用 load([]) 清空。
  const plugin = art.plugins.artplayerPluginDanmuku;
  plugin.config({danmuku: []});
  await plugin.load();
  allDanmaku.value = {[String(episodeNumber)]: [...rows].sort((a, b) => a.time - b.time)};
  danmuConfig.value.loadedUntil = Math.max(0, (art.currentTime || 0) - 1);
  lastDanmuLoadedUntil = -1;
  danmuTitleData.value.html = rows.length ? `弹幕加载完成，${rows.length}条数据` : '未匹配到本集弹幕，可点击“搜索弹幕”手动选择';
  art.layers.update(danmuTitleData.value);
}
async function useDanmakuEpisode() {
  const selected = danmakuEpisodes.value[danmakuSelectedEpisode.value];
  if (!selected || danmakuBusy.value) return;
  const episodeGuid = episode_guid.value;
  const parentGuid = guid.value;
  const episodeNumber = playInfo.value.episode_number ?? 1;
  danmakuBusy.value = true;
  danmakuSearchError.value = '';
  const generation = ++danmakuLoadGeneration;
  try {
    const json = await danmakuRequest('/danmu/get?' + new URLSearchParams({url: selected.url}));
    if (episodeGuid !== episode_guid.value || generation !== danmakuLoadGeneration) return;
    const rows = episodeDanmaku(json, episodeNumber);
    if (!rows.length) throw new Error('这个播放链接未返回弹幕，请选择其他平台或集数');
    await danmakuRequest('/danmu/select', {method: 'POST', body: JSON.stringify({
      guid: episodeGuid, parent_guid: parentGuid, url: selected.url
    })});
    if (episodeGuid !== episode_guid.value || generation !== danmakuLoadGeneration) return;
    await applyDanmakuRows(rows, episodeNumber);
    await getVideoConfig();
    void GetEmoji();
    COMMON.ShowMsg(`当前集来源已保存，加载 ${rows.length} 条弹幕`);
  } catch (error) { if (episodeGuid === episode_guid.value) danmakuSearchError.value = errorText(error); }
  finally { danmakuBusy.value = false; }
}
const currentSubtitle = ref(null);
let serverSubtitleGuid = null;
let subtitleSwitchGeneration = 0;
const useAssSubtitles = ref(localStorage.getItem('fnosAssSubtitles') !== 'false');
const subtitleRenderMode = ref('text');
const assRenderer = new SubtitleOverlay({onFailure: error => {
  COMMON.ShowMsg(errorText(error) + '，正在切换普通字幕');
  void switchSubtitleUrl({plain: true}).catch(showSubtitleError);
}});
const pgsRenderer = new SubtitleOverlay({kind: 'pgs', onFailure: showSubtitleError});
const showSubtitleSearch = ref(false);
const subtitleSearchBusy = ref(false);
const subtitleDownloadBusy = ref(false);
const subtitleSearchDone = ref(false);
const subtitleSearchError = ref('');
const subtitlePlaybackError = ref('');
const subtitleSearchLanguage = ref('zh-CN');
const subtitleSearchLanguages = ref([{label: '中文', value: 'zh-CN'}, {label: 'English', value: 'en'}]);
const subtitleSearchFilter = ref('');
const subtitleResults = ref([]);
const subtitleTrackGuid = ref(null);
let subtitleSearchGeneration = 0;
const filteredSubtitleResults = computed(() => subtitleResults.value.filter(s =>
  s.filename.toLowerCase().includes(subtitleSearchFilter.value.trim().toLowerCase())));
const subtitleTrackChoices = computed(() => subtitleOptions(StreamList.value?.subtitle_streams, currentSubtitle.value?.guid)
  .map(s => ({label: s.html, value: s.guid || ''})));
function subtitleMediaGuid() {
  return StreamList.value?.video_streams?.[0]?.media_guid || StreamList.value?.files?.[0]?.guid;
}
async function openSubtitleSearch() {
  art?.pause();
  if (art) art.setting.show = false;
  // 模态框挂在页面上，退出浏览器原生全屏后仍可操作。
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  subtitleTrackGuid.value = currentSubtitle.value?.guid || '';
  showSubtitleSearch.value = true;
  try {
    const config = await COMMON.requests('GET', '/api/v1/sys/config');
    if (Array.isArray(config?.supported_languages) && config.supported_languages.length) {
      subtitleSearchLanguages.value = config.supported_languages.map(value => ({value,
        label: ({'zh-CN': '中文', en: 'English'})[value] || value}));
      if (!config.supported_languages.includes(subtitleSearchLanguage.value))
        subtitleSearchLanguage.value = config.default_language || config.supported_languages[0];
    }
  } catch { /* 使用已知默认语言仍可查询 */ }
}
async function searchSubtitles() {
  const mediaGuid = subtitleMediaGuid();
  if (!mediaGuid || subtitleSearchBusy.value) return;
  const generation = ++subtitleSearchGeneration;
  subtitleSearchBusy.value = true;
  subtitleSearchError.value = '';
  subtitleSearchDone.value = false;
  subtitleResults.value = [];
  try {
    const data = await COMMON.requests('POST', '/api/v1/subtitle/search', true, {
      lan: subtitleSearchLanguage.value, media_guid: mediaGuid
    });
    if (generation !== subtitleSearchGeneration || mediaGuid !== subtitleMediaGuid()) return;
    subtitleResults.value = subtitleSearchResults(data, StreamList.value?.subtitle_streams);
    subtitleSearchDone.value = true;
  } catch (error) {
    if (generation === subtitleSearchGeneration) subtitleSearchError.value = errorText(error);
  } finally {
    if (generation === subtitleSearchGeneration) subtitleSearchBusy.value = false;
  }
}
async function useSearchedSubtitle(result) {
  if (subtitleDownloadBusy.value) return;
  const mediaGuid = subtitleMediaGuid();
  subtitleDownloadBusy.value = true;
  subtitleSearchError.value = '';
  try {
    let stream = StreamList.value?.subtitle_streams?.find(s => s.guid === result.existingGuid);
    if (!stream) stream = await downloadSubtitle(COMMON.requests, mediaGuid, result);
    if (mediaGuid !== subtitleMediaGuid()) return;
    stream = {...stream, trim_id: stream.trim_id || result.trimId};
    const existing = StreamList.value.subtitle_streams || [];
    StreamList.value.subtitle_streams = [...existing.filter(s => s.guid !== stream.guid), stream];
    subtitleResults.value = subtitleSearchResults({subtitles: subtitleResults.value}, StreamList.value.subtitle_streams);
    subtitleTrackGuid.value = stream.guid;
    await switchSubtitle({...stream, html: result.filename, forceReload: true});
    if (!subtitlePlaybackError.value) COMMON.ShowMsg('字幕已添加并选择，请继续播放');
  } catch (error) { subtitleSearchError.value = errorText(error); }
  finally { subtitleDownloadBusy.value = false; }
}
async function reloadSelectedSubtitle() {
  const selected = StreamList.value?.subtitle_streams?.find(s => s.guid === subtitleTrackGuid.value);
  await switchSubtitle(selected ? {...selected, html: selected.title || '字幕', forceReload: true}
    : {guid: null, index: -1, html: '关闭字幕'});
}
const subtitleFontSizeKey = 'fnosSubtitleFontSize';
function savedSubtitleFontSize() {
  try {
    const saved = localStorage.getItem(subtitleFontSizeKey);
    const value = Number(saved);
    return saved && Number.isFinite(value) ? Math.min(60, Math.max(12, Math.round(value))) : 20;
  } catch { return 20; }
}
const subtitleFontSize = ref(savedSubtitleFontSize());
function setSubtitleFontSize(value) {
  subtitleFontSize.value = Math.min(60, Math.max(12, Math.round(Number(value) || 20)));
  if (art) art.subtitle.style({fontSize: `${subtitleFontSize.value}px`});
  try { localStorage.setItem(subtitleFontSizeKey, String(subtitleFontSize.value)); } catch {}
  return `${subtitleFontSize.value}px`;
}
const use302Play = localStorage.getItem('use_302_play');
const use_302_play = ref(use302Play === null ? false : use302Play === 'true')
let currentVttBlob = null;
let subtitleErrorShown = false;
const subtitleLoader = new SegmentedSubtitleLoader({
  getTime: () => art?.currentTime || 0,
  fetchText: async (address) => {
    const response = await fetch(address, {
      credentials: 'same-origin', headers: {Authorization: VueCookies.get('authorization') || ''}
    });
    if (!response.ok) throw new Error(`字幕服务返回 HTTP ${response.status}`);
    const text = await response.text();
    if (text.trim().startsWith('{')) {
      const data = JSON.parse(text);
      throw new Error(data.code === -2 ? '字幕鉴权失败，请重新登录' : errorText(data));
    }
    return text;
  },
  clear: () => {
    assRenderer.clear();
    pgsRenderer.clear();
    subtitleRenderMode.value = 'text';
    if (art) art.subtitle.show = false;
    if (currentVttBlob) URL.revokeObjectURL(currentVttBlob);
    currentVttBlob = null;
  },
  render: async (text) => {
    if (!art || subtitleRenderMode.value !== 'text') return;
    const generation = subtitleLoader.generation;
    const next = createBlobVTTUrl(text);
    const previous = currentVttBlob;
    currentVttBlob = next;
    await art.subtitle.switch(next, {type: 'vtt', encoding: 'utf-8'});
    if (generation === subtitleLoader.generation && currentSubtitle.value) art.subtitle.show = subtitleRenderMode.value === 'text';
    if (previous) URL.revokeObjectURL(previous);
  }
});

function showSubtitleError(error) {
  subtitlePlaybackError.value = errorText(error).includes('404')
    ? '当前字幕文件或分段已不可用，请打开“搜索字幕”重新加载、切换轨道或搜索其他字幕。' : errorText(error);
  if (!subtitleErrorShown) COMMON.ShowMsg(subtitlePlaybackError.value);
  subtitleErrorShown = true;
}
const danmuTitleData = ref({
  name: "danmuTitle",
  html: "弹幕加载中...",
  style: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    color: '#fff',
    fontSize: '16px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: '4px 8px',
    borderRadius: '4px',
  }
})
const danmuConfig = ref({
  loadedUntil: 0,
  segmentDuration: 10
})

const qualitySelector = ref([]);
const currentQuality = ref(null);

const IsFullscreen = () => {
  art.fullscreen
}

function selectPlayback(query) {
  const selected = playbackSelection(query);
  guid.value = selected.guid;
  gallery_type.value = selected.category;
  episode_guid.value = selected.episodeGuid;
  EpisodeList.value = null;
}
selectPlayback(proxy.$route.query);

var danmu_setting = window.localStorage.danmu_setting;
if (danmu_setting === undefined) {
  danmu_setting = JSON.stringify({
    value: {
      speed: 8.5,
      opacity: 0.5,
      fontSize: window.innerWidth <= 768 ? '2.5%' : '3%',
      color: '#FFFFFF',
      mode: 0,
      margin: window.innerWidth <= 768 ? [5, '85%'] : [10, '75%'],
      antiOverlap: true,
      useWorker: true,
      synchronousPlayback: true,
      theme: 'light',
      heatmap: false,
      beforeEmit: (danmu) => !!danmu.text.trim(),
      emitter: false,
      mount: undefined
    }
  })
}
danmu_setting = JSON.parse(danmu_setting).value

const setting = ref({
  url: "",
  id: "",
  customType: {
    m3u8: function (video, url, player) {
      const hls = replaceMediaEngine(player, () => new Hls({
        enableWebVTT: false, // 仍然关闭 WebVTT 的原生渲染
        renderTextTracksNatively: false,
        xhrSetup: (xhr, reqUrl) => {
          if (reqUrl.endsWith('.vtt')) {
            // 在真正发送前就中断请求
            xhr.abort();
          }
          // 还可以在这里对其他请求做自定义头等处理
        },
      }));
      hls.loadSource(url)
      hls.attachMedia(video)
    },
    flv: function (video, url, player) {
      const flvPlayer = replaceMediaEngine(player, () => flvjs.createPlayer({
        type: 'flv',
        url: url
      }))
      flvPlayer.attachMediaElement(video)
      flvPlayer.load()
    },
    mkv: function (video, url, player) {
      releaseMediaEngine(player);
      video.src = url;
    },
    mp4: function (video, url, player) {
      releaseMediaEngine(player);
      video.src = url;
    }
  },
  title: "",
  hotkey: true,
  poster: '',
  volume: 0.5,
  isLive: false,
  muted: false,
  autoplay: false,
  lock: true,
  pip: false,
  autoSize: false,
  autoMini: true, // 当播放器滚动到浏览器视口以外时，自动进入 迷你播放 模式
  screenshot: !/Android|webOS|iPhone|iPod|BlackBerry/i.test(navigator.userAgent),
  setting: true,
  loop: true,
  flip: false,    // 是否显示视频翻转功能，目前只出现在 设置面板 和 右键菜单 里
  playbackRate: false,
  aspectRatio: true,
  fastForward: !touchPlayer,
  gesture: !touchPlayer,
  fullscreen: !touchPlayer,
  fullscreenWeb: !touchPlayer,
  subtitleOffset: false,
  miniProgressBar: false,
  mutex: true,
  backdrop: true,
  playsInline: true,
  autoPlayback: true,
  airplay: true,
  theme: '#23ade5',
  lang: navigator.language.toLowerCase(),
  // whitelist: [(ua) => /iPhone/gi.test(ua)],
  moreVideoAttr: {
    crossOrigin: 'anonymous',
  },
  settings: [],
  controls: [
    // {
    //     position: 'right',
    //     index: 15,
    //     html: '<img width="18" heigth="18" src="./images/download.svg">',
    //     tooltip: '下载视频',
    //     style: {
    //         color: 'red',
    //     },
    //     click: function () {
    //         const a = document.createElement('a');
    //         a.setAttribute('href', url.value);
    //         a.setAttribute('target', "_blank");
    //         a.setAttribute('download', "001.mp4");
    //         a.click();
    //     },
    // }


  ],
  quality: [],
  icons: {
    fullscreenOn: fullscreenIcon,
    fullscreenOff: fullscreenExitIcon,
    loading: '<img width="60" heigth="60" src="./images/loading.gif">',
    state: '<img width="60" heigth="60" src="./images/play2.svg">',
    indicator: '<img width="16" heigth="16" src="./images/indicator.svg">',
  },
  plugins: [
    artplayerPluginDanmuku(danmu_setting)
  ],
})
const ArtplayerStyle = {
  width: '100%',
  height: window.innerWidth <= 768 ? '56.25vw' : '56.25vw',
  maxHeight: window.innerWidth <= 768 ? 'calc(100vh - 100px)' : 'calc(100vh - 150px)',
  margin: '0 auto',
}

const debounce = (fn, delay) => {
  let timer = null;
  return function () {
    let context = this;
    let args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(context, args);
    }, delay);
  }
}

function getDanmuparams() {
  let episode_number = playInfo.value.episode_number === undefined ? 1 : playInfo.value.episode_number;
  let episode_title = playInfo.value.title;
  let season = playInfo.value.type !== "Movie";
  let title = season ? playInfo.value.tv_title : playInfo.value.title
  let season_number = season ? playInfo.value.season_number : 1
  return new URLSearchParams({
    douban_id: playInfo.value.douban_id ?? '', episode_number, episode_title: episode_title ?? '',
    title: title ?? '', season_number: season_number ?? 1, season,
    guid: episode_guid.value ?? '', parent_guid: guid.value ?? ''
  }).toString();
}

async function loadDanmuku() {
  const generation = ++danmakuLoadGeneration;
  const episodeGuid = episode_guid.value;
  danmuTitleData.value.html = `弹幕加载中...`
  art.layers.update(danmuTitleData.value)
  let episode_number = playInfo.value.episode_number === undefined ? 1 : playInfo.value.episode_number;
  let danmuku = `/danmu/get?${getDanmuparams()}`;
  return fetch(danmuku)
      .then(res => {
        if (!res.ok) throw new Error(`弹幕服务返回 HTTP ${res.status}`);
        return res.json();
      })
      .then(async json => {
        if (generation !== danmakuLoadGeneration || episodeGuid !== episode_guid.value) return;
        const rows = episodeDanmaku(json, episode_number);
        await applyDanmakuRows(rows, episode_number);
      }).catch(err => {
    if (generation !== danmakuLoadGeneration || episodeGuid !== episode_guid.value) return;
    danmuTitleData.value.html = '弹幕加载失败，请检查服务日志';
    COMMON.ShowMsg(errorText(err));
    art.layers.update(danmuTitleData.value)
  })
}

// 获取清晰度
function setQualityOptions(res) {
  QualityData.value = res;

  // 按分辨率分组，每个分辨率下按码率排序
  const qualityGroups = {};
  res.forEach(item => {
    if (!qualityGroups[item.resolution]) {
      qualityGroups[item.resolution] = [];
    }
    qualityGroups[item.resolution].push({
      bitrate: item.bitrate,
      progressive: item.progressive
    });
  });

  // 对每个分辨率组内的码率进行排序
  Object.keys(qualityGroups).forEach(resolution => {
    qualityGroups[resolution].sort((a, b) => b.bitrate - a.bitrate);
  });

  // 构建画质选择器数据
  const selector = [];
  const resolutions = Object.keys(qualityGroups).sort((a, b) => {
    const resolutionOrder = {'4k': 4, '1080': 3, '720': 2, '480': 1, '360': 0};
    return resolutionOrder[b] - resolutionOrder[a];
  });

  resolutions.forEach(resolution => {
    const qualities = qualityGroups[resolution];
    const baseItem = {
      html: resolution,
      selector: qualities.map(quality => ({
        html: `${resolution} (${(quality.bitrate / 1000000).toFixed(1)}Mbps)`,
        bitrate: quality.bitrate,
        resolution: resolution,
        progressive: quality.progressive
      }))
    };
    selector.push(baseItem);
  });

  qualitySelector.value = selector;

  // 设置默认画质为最高质量
  if (selector.length > 0 && selector[0].selector.length > 0) {
    currentQuality.value = selector[0].selector[0];
  }
}

// 切换清晰度
async function switchQuality(item, $dom, event) {
  // 处理选择器返回的数据结构
  const qualityData = item.selector ? item.selector[0] : item;
  if (!qualityData || !qualityData.bitrate || !qualityData.resolution) {
    console.error('Invalid quality item:', qualityData);
    return;
  }

  try {
    await mediaP("media.checkPlayLink", urlBase.value)
    let api = "/api/v1/media/p";
    let _data = {
      "req": "media.resetQuality",
      "reqid": "1234567890ABCDEF2s",
      "playLink": urlBase.value,
      "quality": {
        "resolution": qualityData.resolution,
        "bitrate": qualityData.bitrate
      },
      "startTimestamp": Math.floor(art.currentTime),
      "clearCache": true
    };

    art.loading.show = true;
    let res = await COMMON.requests("POST", api, true, _data);

    if (res.updateM3u8) {
      // 更新当前画质状态
      currentQuality.value = {
        resolution: qualityData.resolution,
        bitrate: qualityData.bitrate,
        html: `${qualityData.resolution} (${(qualityData.bitrate / 1000000).toFixed(1)}Mbps)`
      };

      // 更新播放器URL
      await art.switchQuality(url.value);
      COMMON.ShowMsg(`已切换到${qualityData.resolution} (${(qualityData.bitrate / 1000000).toFixed(1)}Mbps)`);

    }
  } catch (error) {
    console.error('Failed to switch quality:', error);
    COMMON.ShowMsg('画质切换失败，请重试');
  } finally {
    art.loading.show = false;
  }
}

async function GetEpisodeList(generation = null) {
  let api = "/api/v1/episode/list/" + guid.value;
  const episodes = await COMMON.requests("GET", api, true);
  if (generation !== null && generation !== initializationGeneration) return;
  EpisodeList.value = episodes;
}

// 获取播放信息
async function GetPayInfo(_guid, operation = null) {
  let api = "/api/v1/play/info";
  let _data = {
    "item_guid": _guid
  }
  let res = await COMMON.requests("POST", api, true, _data, {signal: operation?.signal})
  operation?.assertCurrent();
  return res;
}

async function GetChannels(s) {
  return s < 6 ? 2 : device.mediaCanPlay.audioChannels >= 6 ? 6 : 2
}

async function GetPalyUrlBy302(operation = null) {
  let regex = /\d+-\d+-\S+/;
  // 获取远程挂载的视频信息
  let remote = StreamList.value.files.find(o => regex.test(o.path))
  if (remote !== null && remote !== undefined && use_302_play.value) {
    let _data = {
      path: remote.path
    }
    let res = await axios.get("/api/play", {
      signal: operation?.signal,
      params: _data,
      headers: {Authorization: VueCookies.get("authorization")}
    })
    operation?.assertCurrent();
    if (res.data.code === 0) {
      url.value = res.data.data;
      playUrl.value = res.data.data
    }
  }
}

async function GetPalyUrl(startTimestamp = playInfo.value.watched_ts, operation = null, audioOverride = currentAudio.value) {
  if (art !== null && art !== undefined) {
    art.loading.show = true;
  }
  let api = "/api/v1/play/play"
  const audio = audioOverride;
  const _channels = audio?.channels || 2;
  const local = primaryMediaFile(StreamList.value);
  let _data = {
    "media_guid": local.guid,
    "video_guid": StreamList.value.video_streams[0].guid,
    "video_encoder": StreamList.value.video_streams[0].codec_name,
    "resolution": QualityData.value[0].resolution,
    "bitrate": StreamList.value.video_streams[0].bps,
    "startTimestamp": Math.max(0, Math.floor(Number(startTimestamp) || 0)),
    "audio_encoder": "aac",
    "audio_guid": audio?.guid || '',
    "subtitle_guid": streamSubtitleGuid(currentSubtitle.value),
    "channels": await GetChannels(_channels)
  };
  let res = await COMMON.requests("POST", api, true, _data, {signal: operation?.signal})
  operation?.assertCurrent();
  if (typeof res?.play_link === 'string' && res.play_link) {
    serverSubtitleGuid = _data.subtitle_guid;
    urlBase.value = res.play_link;
    url.value = COMMON.fnHost + res.play_link;
    playUrl.value = window.location.origin + url.value
    if (use_302_play.value) {
      await GetPalyUrlBy302(operation);
    }
  } else {
    throw new Error('播放链接获取失败，请切换清晰度或重试');
  }
}

function playbackRecordSnapshot() {
  if (art && art.currentTime >= 5 && StreamList.value?.video_streams?.length && QualityData.value?.length) {
    return {
      "item_guid": playInfo.value?.guid || episode_guid.value,
      "media_guid": StreamList.value.video_streams[0].media_guid,
      "video_guid": StreamList.value.video_streams[0].guid,
      "audio_guid": currentAudio.value?.guid || '',
      "subtitle_guid": currentSubtitle.value?.guid || "",
      "resolution": QualityData.value[0].resolution,
      "bitrate": QualityData.value[0].bitrate,
      "ts": Math.floor(art.currentTime),
      "duration": art.duration,
      "play_link": urlBase.value,
      "create_time": Math.floor(Date.now() / 1000),
      "playback_speed": art.playbackRate,
      "guid": guid.value,
    }
  }
  return null;
}
async function SendPlayRecord() {
  return progressReporter.submit();
}
const progressReporter = createProgressReporter(playbackRecordSnapshot,
  data => COMMON.requests('POST', '/api/v1/play/record', true, data),
  () => { if (art) art.notice.show = '播放进度暂未同步，将在下次上报时重试'; });

async function switchAudio(item) {
  const selected = StreamList.value?.audio_streams?.find(track => track.guid === item.guid);
  if (!selected || selected.guid === currentAudio.value?.guid) return audioLabel(currentAudio.value);
  const previous = currentAudio.value;
  const previousLink = urlBase.value;
  const previousUrl = url.value;
  const previousPublicUrl = playUrl.value;
  const position = Math.max(0, Math.floor(art.currentTime));
  const paused = art.video.paused;
  const operation = playbackSession.begin();
  try {
    await GetPalyUrl(position, operation, selected);
    operation.assertCurrent();
    currentAudio.value = selected;
    playInfo.value.watched_ts = position;
    await art.switchUrl(url.value);
    if (paused) art.pause();
    if (selected.language) {
      preferredAudioLanguage.value = selected.language;
      writePlayerPreference(localStorage, COMMON.userKey, 'audioLanguage', selected.language);
    }
    if (previousLink && previousLink !== urlBase.value) void mediaP('media.quit', previousLink).catch(() => {});
    return audioLabel(selected);
  } catch (error) {
    if (operation.isCurrent()) {
      if (urlBase.value && urlBase.value !== previousLink) void mediaP('media.quit', urlBase.value).catch(() => {});
      currentAudio.value = previous;
      urlBase.value = previousLink;
      url.value = previousUrl;
      playUrl.value = previousPublicUrl;
      COMMON.ShowMsg('音轨切换失败：' + errorText(error));
    }
    return audioLabel(currentAudio.value);
  } finally {
    if (operation.isCurrent() && art) art.loading.show = false;
  }
}

async function GetSkipList() {
  // const instance = axios.create()
  // let api = "/api/skipList?guid=" + guid.value
  // let res = await instance.get(api)
  // if (res.data.code === 0) {
  //   skipList.value = res.data.data
  // }
}

async function mediaP(req, playLink) {
  let api = "/api/v1/media/p"
  let data = {
    "req": req,
    "reqid": "1234567890ABCDEF",
    "playLink": playLink
  }
  let res = await COMMON.requests("POST", api, true, data)
}

async function GetEmoji() {
  const episode = episode_guid.value;
  try {
    let api = "/danmu/getEmoji?" + getDanmuparams()
    let res = await fetch(api)
    let res_json = await res.json()
    if (episode === episode_guid.value) emojos.value = res_json;
  } catch {
    if (episode === episode_guid.value) emojos.value = [];
  }
}

async function putVideoConfig() {
  let sendData = {
    list: [],
    url: []
  }
  if (seasonConfig.value.list !== undefined) {
    for (let item of seasonConfig.value.list) {
      if (!(item.startTime === 0 && item.endTime === 0)) {
        if (item.endTime === null) {
          // 如果endtime为空，直接跳到最后
          item.endTime = art.duration
        }
        sendData.list.push(item)
      }
    }
  }
  if (seasonConfig.value.url !== undefined) {
    for (let item of seasonConfig.value.url) {
      if (item.url !== "" && item.url !== null && item.url !== undefined) {
        sendData.url.push(item)
      }
    }
  }
  try {
    let api = "/api/videoConfig?episode_guid=" + episode_guid.value + "&guid=" + guid.value
    let res = await axios.post(api, sendData, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: VueCookies.get("authorization")
      },
    })
    if (res.data?.code !== 0) throw new Error(res.data?.msg || '保存配置失败');
    skipList.value = sendData.list
    seasonConfig.value = sendData
    art.plugins.artplayerPluginDanmuku.load();
    void loadDanmuku()
  } catch (error) {
    COMMON.ShowMsg(errorText(error));
    return;
  }
  showSetUp.value = false;

}

async function getVideoConfig() {
  const episode = episode_guid.value, season = guid.value;
  try {
    let api = "/api/videoConfig?episode_guid=" + episode_guid.value + "&guid=" + guid.value
    let res = await axios.get(api, {headers: {Authorization: VueCookies.get("authorization")}})
    if (episode !== episode_guid.value || season !== guid.value) return;
    if (!Array.isArray(res.data?.list) || !Array.isArray(res.data?.url)) throw new Error('播放配置返回格式异常');
    seasonConfig.value = res.data;
    skipList.value = seasonConfig.value.list
  } catch (err) {
  }
}


// 添加字幕切换函数
async function switchSubtitle(item, $dom, event) {
  if (!item) return '字幕';
  const position = Math.max(0, Math.floor(art?.currentTime || 0));
  const selection = ++subtitleSwitchGeneration;
  subtitleLoader.clear();
  try {
    subtitlePlaybackError.value = '';
    if (isPgsSubtitle(item) && serverSubtitleGuid === '') {
      currentSubtitle.value = item;
      subtitleTrackGuid.value = item.guid;
      subtitleErrorShown = false;
      await switchSubtitleUrl();
      if (selection !== subtitleSwitchGeneration) return item.html;
      await UpdateControl(art);
      return item.html;
    }
    if (item.guid && (item.forceReload || item.extra_file)) {
      const previousLink = urlBase.value;
      currentSubtitle.value = item;
      subtitleErrorShown = false;
      playInfo.value.watched_ts = position;
      await GetPalyUrl(position);
      await art.switchUrl(url.value);
      art.seek = position;
      if (previousLink && previousLink !== urlBase.value) void mediaP('media.quit', previousLink).catch(() => {});
      await UpdateControl(art);
      return item.html;
    }
    const res = await COMMON.requests('POST', '/api/v1/media/p', true, {
      req: 'media.resetSubtitle', reqid: '1234567890ABCDEF', playLink: urlBase.value,
      startTimestamp: position, subtitleIndex: item.guid && !isPgsSubtitle(item) ? item.index : -1
    });
    if (selection !== subtitleSwitchGeneration) return item.html;
    if (res?.result === 'fail') throw new Error(`字幕切换失败（${res.errno ?? '未知错误'}）`);
    serverSubtitleGuid = streamSubtitleGuid(item);
    currentSubtitle.value = item.guid ? item : null;
    subtitleTrackGuid.value = item.guid || '';
    subtitleErrorShown = false;
    if (res?.updateM3u8) {
      playInfo.value.watched_ts = position;
      await GetPalyUrl(position);
      await art.switchUrl(url.value);
      art.seek = position;
    } else if (currentSubtitle.value) {
      await switchSubtitleUrl();
    }
    await UpdateControl(art);
    return item.html;
  } catch (error) {
    if (selection === subtitleSwitchGeneration) showSubtitleError(error);
    return '字幕';
  }
}

async function addArtConfig(_art, key, v) {
  try {
    _art[key].remove(v.name)
  } catch (err) {
  }
  _art[key].add(v)
}

async function UpdateControl(_art) {
  let forData = []

  // 添加画质选择器
  if (qualitySelector.value.length > 0) {
    const qualityControl = {
      disable: false,
      index: touchPlayer ? 2 : 1,
      name: '画质',
      position: 'right',
      html: touchPlayer ? (currentQuality.value?.resolution || '画质') : currentQuality.value ?
          `${currentQuality.value.resolution} (${(currentQuality.value.bitrate / 1000000).toFixed(1)}Mbps)` :
          '画质',
      selector: qualitySelector.value.map(group => ({
        html: group.html,
        selector: group.selector.map(item => ({
          html: item.html,
          bitrate: item.bitrate,
          resolution: item.resolution,
          progressive: item.progressive
        }))
      })),
      onSelect: switchQuality
    };
    forData.push(qualityControl);
  }

  let 倍速 = {
    disable: false,
    index: 2,
    name: '倍速',
    position: 'right',
    html: art.playbackRate + '×',
    selector: [0.5, 0.8, 1, 1.2, 1.5, 1.8, 2, 2.5, 2.8, 3].map(rate => ({rate, html: `${rate}×`})),
    onSelect: function (item, $dom) {
      art.playbackRate = item.rate;
      return `${item.rate}×`;
    },
  }
  倍速.selector.forEach(item => {
    if (item.rate === art.playbackRate) {
      item.default = true;
    }
  })
  forData.push(倍速)

  // 同时提供播放器按钮和设置菜单，使用 guid 保留所有字幕轨道。
  try { _art.controls.remove('字幕'); } catch {}
  try { _art.setting.remove('字幕选择'); } catch {}
  if (StreamList.value && StreamList.value.subtitle_streams && StreamList.value.subtitle_streams.length > 0) {
    const choices = subtitleOptions(StreamList.value.subtitle_streams, currentSubtitle.value?.guid);
    const subtitleControl = {
      disable: false,
      index: 3,
      name: '字幕',
      position: 'right',
      html: '字幕',
      selector: choices,
      onSelect: switchSubtitle
    };
    forData.push(subtitleControl);
    await addArtConfig(_art, 'setting', {
      name: '字幕选择', html: '字幕', tooltip: '选择字幕轨道',
      selector: subtitleOptions(StreamList.value.subtitle_streams, currentSubtitle.value?.guid),
      onSelect: switchSubtitle
    });
  }

  if (EpisodeList.value !== null && EpisodeList.value.length > 0) {
    let 下一集 = {
      name: '下一集',
      position: 'left',
      index: 11,
      html: '<img width="22" heigth="22" src="./images/next.svg">',
      tooltip: '下一集',
      style: {
        opacity: nextEpisode(EpisodeList.value, playInfo.value, gallery_type.value) ? '1' : '0.35',
        pointerEvents: nextEpisode(EpisodeList.value, playInfo.value, gallery_type.value) ? '' : 'none',
      },
      click: function () {
        play_next()
      }
    }
    forData.push(下一集)

    let 选集_selector = []
    for (let item of EpisodeList.value) {
      选集_selector.push(
          {
            default: playInfo.value.episode_number === item.episode_number,
            html: `第${item.episode_number}集：${item.title}`,
            episode_guid: item.guid
          }
      )
    }

    let 选集 = {
      disable: false,
      name: '选集',
      index: touchPlayer ? 1 : 4,
      position: 'right',
      html: "选集",
      selector: 选集_selector,
      onSelect: async function (item, $dom, event) {
        void SendPlayRecord();
        episode_guid.value = item.episode_guid;
        try { await play(); } catch (error) {
          if (error.name !== 'AbortError' && error.name !== 'CanceledError') COMMON.ShowMsg(errorText(error));
        }
        return "选集";
      }
    }
    forData.push(选集)
  }

  for (let item of forData) {
    if (['画质', '倍速', '选集'].includes(item.name)) {
      const label = {画质: '清晰度', 倍速: '播放速度', 选集: '选集'}[item.name];
      await addArtConfig(_art, 'setting', {...item, name: item.name + '设置', html: label,
        tooltip: item.name === '画质' ? (currentQuality.value?.html || '默认') : item.html,
        onSelect: async (selection, element, event) => {
          const value = await item.onSelect(selection, element, event);
          return item.name === '画质' ? (currentQuality.value?.html || '默认') : value;
        },
      });
      if (touchPlayer) item.disable = item.name === '倍速';
    }
    await addArtConfig(_art, 'controls', item)
  }

  await addArtConfig(_art, 'setting', {
    name: '字幕大小', html: '字幕大小', tooltip: `${subtitleFontSize.value}px`,
    range: [subtitleFontSize.value, 12, 60, 1],
    onChange: item => setSubtitleFontSize(item.range[0]),
    onRange: item => setSubtitleFontSize(item.range[0])
  });
  const audioTracks = StreamList.value?.audio_streams || [];
  await addArtConfig(_art, 'setting', {
    name: '音轨选择', html: '音轨', tooltip: audioLabel(currentAudio.value),
    selector: audioTracks.length ? audioTracks.map(track => ({guid: track.guid,
      html: audioLabel(track), default: track.guid === currentAudio.value?.guid})) : [{html: '当前影片无音轨'}],
    onSelect: switchAudio
  });
  await addArtConfig(_art, 'setting', {
    name: '自动连播', html: '自动连播', switch: autoPlayNext.value,
    onSwitch: item => {
      autoPlayNext.value = !item.switch;
      writePlayerPreference(localStorage, COMMON.userKey, 'autoPlayNext', autoPlayNext.value);
      if (!autoPlayNext.value) autoplayCountdown.cancel();
      return autoPlayNext.value;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '播完本集停止', html: '播完本集停止', switch: stopAfterCurrent.value,
    onSwitch: item => {
      stopAfterCurrent.value = !item.switch;
      if (stopAfterCurrent.value) autoplayCountdown.cancel();
      return stopAfterCurrent.value;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: 'ASS特效字幕', html: 'ASS 特效字幕', tooltip: useAssSubtitles.value ? '原始样式' : '普通字幕',
    switch: useAssSubtitles.value,
    onSwitch: item => {
      useAssSubtitles.value = !item.switch;
      localStorage.setItem('fnosAssSubtitles', String(useAssSubtitles.value));
      if (currentSubtitle.value) void switchSubtitleUrl().catch(showSubtitleError);
      return useAssSubtitles.value;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '搜索字幕', html: '搜索字幕 / 重新加载', tooltip: '手动查询与选择',
    onClick: openSubtitleSearch
  });
  await addArtConfig(_art, 'setting', {
    name: '搜索弹幕', html: '搜索弹幕', tooltip: '选择平台与集数', onClick: openDanmakuSearch
  });

  await addArtConfig(_art, 'setting', {
    name: "跳过片头片尾",
    html: '跳过片头片尾',
    tooltip: VueCookies.get('skip') === null ? "打开" : (VueCookies.get('skip') ? "打开" : "关闭"),
    switch: VueCookies.get('skip') === null ? true : VueCookies.get('skip'),
    onSwitch: function (item, $dom, event) {
      VueCookies.set('skip', !item.switch, -1);
      const nextState = !item.switch;
      item.tooltip = nextState ? '打开' : '关闭';
      return nextState;
    },
  })
  await addArtConfig(_art, 'setting', {
    name: '是否开启302',
    html: '是否开启302',
    tooltip: use_302_play.value ? '开启' : '关闭',
    switch: use_302_play.value,
    onSwitch: async function (item, $dom, event) {
      use_302_play.value = !item.switch;
      localStorage.use_302_play = use_302_play.value
      let _url = url.value;
      let _currentTime = art.currentTime;
      if (use_302_play.value) {
        await GetPalyUrlBy302();
      }
      if (!use_302_play.value) {
        url.value = COMMON.fnHost + urlBase.value;
        playUrl.value = window.location.origin + url.value
      }
      if (art && _url !== url.value) {
        await art.switchUrl(url.value);
        art.currentTime = _currentTime;
      }
      item.tooltip = use_302_play.value ? '开启' : '关闭';
      return use_302_play.value;
    },
  })

}

async function play() {
  autoplayCountdown.cancel();
  stopAfterCurrent.value = false;
  const operation = playbackSession.begin();
  if (art) art.loading.show = true;
  try {
    subtitleSwitchGeneration++;
    danmakuLoadGeneration++;
    showDanmakuSearch.value = false;
    danmakuResults.value = [];
    danmakuEpisodes.value = [];
    danmakuSearchDone.value = false;
    danmakuSearchError.value = '';
    subtitleSearchGeneration++;
    subtitleSearchBusy.value = false;
    showSubtitleSearch.value = false;
    subtitleResults.value = [];
    subtitleSearchDone.value = false;
    subtitleSearchError.value = '';
    subtitlePlaybackError.value = '';
    if (timerSendPlayRecord.value !== null) {
      clearInterval(timerSendPlayRecord.value)
    }
    let playLink = urlBase.value;
    let initialInfo = null;
    if (!episode_guid.value) {
      initialInfo = await GetPayInfo(guid.value, operation);
      episode_guid.value = initialInfo.item.guid;
    }
    const metadata = await loadPlaybackMetadata(COMMON.requests, episode_guid.value, {signal: operation.signal, initialInfo});
    operation.assertCurrent();
    playInfo.value = metadata.info.item;
    StreamList.value = metadata.streams;
    currentAudio.value = chooseAudio(metadata.streams.audio_streams, playInfo.value.audio_guid, preferredAudioLanguage.value);
    setQualityOptions(metadata.qualities);

    subtitleLoader.clear();
    currentSubtitle.value = null;
    // 优先使用播放记录中的轨道，其次使用默认轨道。
    if (StreamList.value && StreamList.value.subtitle_streams && StreamList.value.subtitle_streams.length > 0) {
      const tracks = StreamList.value.subtitle_streams;
      currentSubtitle.value = tracks.find(sub => sub.guid === playInfo.value.subtitle_guid)
        || tracks.find(sub => Number(sub.is_default) === 1) || tracks[0];
    }

    await GetPalyUrl(undefined, operation);
    operation.assertCurrent();
    GetEmoji();
    if (art !== null) {
      await art.switchUrl(url.value);
    }
    if (playLink && playLink !== urlBase.value) {
      void mediaP("media.quit", playLink).catch(() => {});
    }
  } finally {
    if (operation.isCurrent() && art) art.loading.show = false;
  }
}

let nextEpisodeBusy = false;
async function play_next() {
  if (nextEpisodeBusy) return;
  const episode = nextEpisode(EpisodeList.value, playInfo.value, gallery_type.value);
  if (!episode) return;
  const previous = episode_guid.value;
  nextEpisodeBusy = true;
  try {
    void SendPlayRecord();
    episode_guid.value = episode.guid;
    await play();
  } catch (error) {
    if (error.name !== 'AbortError' && error.name !== 'CanceledError') {
      if (episode_guid.value === episode.guid) episode_guid.value = previous;
      COMMON.ShowMsg('切换下一集失败：' + errorText(error));
    }
  } finally {
    nextEpisodeBusy = false;
  }
}

async function switchSubtitleUrl({plain = false} = {}) {
  if (!currentSubtitle.value || !urlBase.value) return;
  subtitleLoader.clear();
  const generation = subtitleLoader.generation;
  const selected = currentSubtitle.value;
  const format = String(selected.codec_name || selected.format || '').toLowerCase();
  if (isPgsSubtitle(selected)) {
    const address = '/danmu/subtitle-pgs?' + new URLSearchParams({item_guid: episode_guid.value, subtitle_guid: selected.guid});
    const data = await waitForAssSubtitle(() => danmakuRequest(address), () => generation === subtitleLoader.generation, {
      onPending: () => COMMON.ShowMsg('正在后台准备 PGS 图片字幕，完成后自动显示')
    });
    if (!data || generation !== subtitleLoader.generation) return;
    const shown = await pgsRenderer.show(art.video, data.url);
    if (!shown || generation !== subtitleLoader.generation) return;
    subtitleRenderMode.value = 'pgs';
    art.subtitle.show = false;
    return;
  }
  if (!plain && useAssSubtitles.value && ['ass', 'ssa'].includes(format)) {
    // 特效提取和字体初始化期间先显示普通字幕；不阻塞 ASS，也不覆盖后来选择的轨道。
    void COMMON.requestsText('/api/v1/subtitle/dl/' + selected.guid, {fmt: 'vtt'}).then(async text => {
      if (generation !== subtitleLoader.generation || subtitleRenderMode.value !== 'text') return;
      if (/^\uFEFF?WEBVTT(?:\s|$)/.test(text)) await subtitleLoader.render(text);
    }).catch(() => {});
    try {
      const address = '/danmu/subtitle-ass?' + new URLSearchParams({item_guid: episode_guid.value, subtitle_guid: selected.guid});
      const data = await waitForAssSubtitle(() => danmakuRequest(address), () => generation === subtitleLoader.generation, {
        onPending: () => COMMON.ShowMsg('正在后台准备特效字幕，期间先显示普通字幕')
      });
      if (!data || generation !== subtitleLoader.generation) return;
      const shown = await assRenderer.show(art.video, data.ass, data.fonts);
      if (generation !== subtitleLoader.generation || !shown) return;
      subtitleRenderMode.value = 'ass';
      art.subtitle.show = false;
      return;
    } catch (error) {
      if (generation !== subtitleLoader.generation) return;
      assRenderer.clear();
      COMMON.ShowMsg('特效字幕加载失败，尝试普通字幕：' + errorText(error));
    }
  }
  // 与当前官方网页一致，优先下载完整文本字幕，避免分段会话失效和重复建轨。
  try {
    const text = await COMMON.requestsText('/api/v1/subtitle/dl/' + currentSubtitle.value.guid, {fmt: 'vtt'});
    if (generation !== subtitleLoader.generation) return;
    if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(text)) throw new Error('完整字幕不是 WebVTT 格式');
    await subtitleLoader.render(text);
    return;
  } catch (error) {
    if (generation !== subtitleLoader.generation) return;
    console.warn('完整字幕获取失败，使用分段字幕：', errorText(error));
  }
  const address = new URL('/fnos' + urlBase.value, window.location.origin);
  address.pathname = address.pathname.replace(/\/preset\.[^/]+$/, '/subtitle.m3u8');
  try { await subtitleLoader.setPlaylist(address.href); }
  catch (error) { if (generation === subtitleLoader.generation - 1) throw error; }
}


async function ready() {
  const player = art, episode = episode_guid.value;
  mountPlayerHeading(art);
  if (timerSendPlayRecord.value !== null) {
    clearInterval(timerSendPlayRecord.value)
  }
  art.playbackRate = localStorage.playbackRate
  art.loading.show = false;
  timerSendPlayRecord.value = setInterval(SendPlayRecord, 10000)
  art.seek = playInfo.value.watched_ts

  if (currentSubtitle.value) {
    subtitleErrorShown = false;
    void switchSubtitleUrl().catch(showSubtitleError);
  }

  danmuConfig.value.loadedUntil = playInfo.value.watched_ts;
  art.layers.update(danmuTitleData.value)
  allDanmaku.value = [];
  void loadDanmuku()
  await GetSkipList();
  await getVideoConfig();
  if (player !== art || episode !== episode_guid.value) return;
  // if (!art.plugins.hasOwnProperty("artplayerPluginDanmuku")) {
  //   // 加载自己修改的弹幕js
  //   await import('../../../public/packages//artplayer-plugin-danmuku.js');
  //   art.plugins.add(window.artplayerPluginDanmuku(danmu_setting));
  // }
  // art.plugins.artplayerPluginDanmuku.config(danmu_setting)

  await UpdateControl(art);
  art.plugins.artplayerPluginDanmuku.reset();

}

const artF = async (data) => {
  art = data;
  setSubtitleFontSize(subtitleFontSize.value);
  bindSubtitleTrack(art);
  art.on('subtitleLoad', () => {
    if (currentSubtitle.value) art.subtitle.update();
  });
  art.on('restart', () => {
    ready();
  });
  art.on('ready', ready);
  art.on('video:ratechange', () => {
    if (!art.fnosTemporarySpeed) {
      localStorage.playbackRate = art.playbackRate;
      const speedSetting = art.setting.find('倍速设置');
      if (speedSetting) speedSetting.tooltip = `${art.playbackRate}×`;
    }
  });
  let lastSkipIndex = -1;
  lastDanmuLoadedUntil = -1;
  art.on("video:timeupdate", () => {
    const currentTime = art.currentTime;

    // 跳过片头片尾
    if (skipList.value && skipList.value.length > 0) {
      const skipIndex = skipList.value.findIndex(
          o => currentTime > o.startTime && currentTime < o.endTime
      );
      const is_skip = VueCookies.get('skip') === 'true' || VueCookies.get('skip') === null;
      if (
          skipIndex !== -1 &&
          is_skip &&
          lastSkipIndex !== skipIndex
      ) {
        COMMON.ShowMsg("当前内容跳过");
        art.currentTime = skipList.value[skipIndex].endTime;
        lastSkipIndex = skipIndex;
        return; // 跳过后不再执行后续弹幕加载
      }
      if (skipIndex === -1) {
        lastSkipIndex = -1;
      }
    }

    // 弹幕分段加载
    let episode_number = playInfo.value.episode_number === undefined ? 1 : playInfo.value.episode_number;
    if (episode_number in allDanmaku.value) {
      let danmuList = allDanmaku.value[episode_number];
      if (currentTime >= danmuConfig.value.loadedUntil) {
        // 避免重复加载同一段
        if (danmuConfig.value.loadedUntil === lastDanmuLoadedUntil) return;
        lastDanmuLoadedUntil = danmuConfig.value.loadedUntil;

        if (
            danmuConfig.value.loadedUntil === 0 ||
            (currentTime - danmuConfig.value.loadedUntil) > (danmuConfig.value.segmentDuration * 2)
        ) {
          danmuConfig.value.loadedUntil = currentTime - 5;
        }
        const startTime = danmuConfig.value.loadedUntil;
        const endTime = startTime + danmuConfig.value.segmentDuration;
        const startIndex = sortedIndexBy(danmuList, {time: danmuConfig.value.loadedUntil}, o => o.time);
        const segment = danmuList.slice(startIndex).filter(d => d.time < endTime);
        if (segment.length && !art.plugins.artplayerPluginDanmuku.isHide) {
          art.plugins.artplayerPluginDanmuku.load(segment); // 追加弹幕
        }
        danmuConfig.value.loadedUntil = endTime;
      }


    }
  });

  art.on('video:timeupdate', () => {
    if (currentSubtitle.value && !subtitlePlaybackError.value) void subtitleLoader.update(art.currentTime).catch(showSubtitleError);
  });
  art.on('video:seeked', () => {
    if (currentSubtitle.value && !subtitlePlaybackError.value) void subtitleLoader.update(art.currentTime).catch(showSubtitleError);
  });

  art.on('video:ended', () => {
    void SendPlayRecord();
    if (autoPlayNext.value && !stopAfterCurrent.value && nextEpisode(EpisodeList.value, playInfo.value, gallery_type.value)) {
      autoplayCountdown.start();
    }
  });
  art.on('video:play', () => autoplayCountdown.cancel());
  art.on('video:seeking', () => autoplayCountdown.cancel());
  art.on('fullscreen', async (state) => {
    await UpdateControl(art);
  });

  art.on('fullscreenWeb', async () => { await UpdateControl(art); });

  art.on('control', (state) => {
    // 控制栏事件可在按下和松开之间触发；保留按钮节点，避免丢失 click。
    if (playerHeading?.parentElement) playerHeading.parentElement.style.display = state ? '' : 'none';
    danmuTitleData.value.disable = !state
    art.layers.update(danmuTitleData.value)
  });

  art.on('artplayerPluginDanmuku:config', (option) => {
    art.storage.name = 'danmu_setting';
    var o = JSON.parse(JSON.stringify(option))
    delete o.danmuku;
    delete o.mount;
    art.storage.set("value", o);
    art.storage.name = 'artplayer_settings';
  });
  art.on('artplayerPluginDanmuku:visible', (danmu) => {
    renderDanmaku(danmu.$ref, emojos.value);
  });
  // art.on('pause', () => {
  //   if_play.value = false;
  // });
  // art.on('play', () => {
  //   if_play.value = true;
  // });


}

const dynamicInputCreateBySkipTime = () => {
  return {
    startTime: 0,
    endTime: 0,
  }
}
const dynamicInputCreateByUrl = () => {
  return {
    url: ""
  }
}

async function getInstance(_art) {
  autoplayCountdown.cancel();
  autoplayPanel = null;
  autoplayText = null;
  disposeMobileGestures();
  disposePlaybackNotices();
  disposeDesktopIdle();
  disposeMobileDanmaku();
  disposeMobileFullscreen();
  disposeMobileFullscreen = installMobileFullscreen(_art);
  mountPlayerHeading(_art);
  disposePlaybackNotices = installPlaybackNoticeFilter(_art);
  await artF(_art);
  disposeMobileDanmaku = installMobileDanmaku(_art);
  disposeMobileGestures = installMobileGestures(_art);
  disposeDesktopIdle = installDesktopIdle(_art);
  art = _art;
  art.id = episode_guid.value
  art.url = url.value
}

let initializationGeneration = 0;
const onMountedFun = async () => {
  const generation = ++initializationGeneration;
  loading.value = !art;
  playbackError.value = '';
  try {
    await getVideoConfig();
    if (generation !== initializationGeneration) return;
    if (gallery_type.value !== "Movie") await GetEpisodeList(generation);
    if (generation !== initializationGeneration) return;
    await play();
  } catch (error) {
    if (generation === initializationGeneration && error.name !== 'AbortError' && error.name !== 'CanceledError') {
      playbackError.value = errorText(error);
      art = null;
    }
  } finally {
    if (generation === initializationGeneration) loading.value = false;
  }
};
const playbackError = ref('');

onBeforeRouteUpdate(async (to, from) => {
  void SendPlayRecord();
  playbackSession.cancel();
  autoplayCountdown.cancel();
  selectPlayback(to.query);
  await onMountedFun();
});

onBeforeRouteLeave(async (to, from) => {
  // Browser/system back in web fullscreen exits fullscreen before leaving playback.
  if (exitPlayerFullscreen(art)) return false;
  void SendPlayRecord();
  playbackSession.cancel();
  if (urlBase.value) void mediaP('media.quit', urlBase.value).catch(() => {});
  autoplayCountdown.cancel();
  if (timerSendPlayRecord.value) {
    clearInterval(timerSendPlayRecord.value)
    timerSendPlayRecord.value = null
  }
});

onBeforeUnmount(async () => {
  initializationGeneration++;
  autoplayCountdown.cancel();
  void SendPlayRecord();
  playbackSession.cancel();
  releaseExternalPlaylist();
  disposeMobileGestures();
  disposePlaybackNotices();
  disposeDesktopIdle();
  disposeMobileDanmaku();
  disposeMobileFullscreen();
  subtitleLoader.clear();
  if (timerSendPlayRecord.value) {
    clearInterval(timerSendPlayRecord.value)
    timerSendPlayRecord.value = null
  }
})
onMounted(async () => {
  await onMountedFun();
})
const flushHiddenProgress = () => { if (document.hidden) void SendPlayRecord(); };
document.addEventListener('visibilitychange', flushHiddenProgress);
window.addEventListener('pagehide', SendPlayRecord);
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', flushHiddenProgress);
  window.removeEventListener('pagehide', SendPlayRecord);
});

</script>

<template>
  <div v-if="loading || playbackError" class="player-loading-shell">
    <button type="button" class="art-back-button player-loading-back" aria-label="返回上一页" @click="backFromPlayer" v-html="backIcon"></button>
    <div v-if="loading" class="load" role="status" aria-label="正在加载影片"></div>
    <n-alert v-else type="error">{{ playbackError }} <n-button @click="onMountedFun">重试</n-button></n-alert>
  </div>
  <div v-else class="content watch-page">
    <n-grid cols="1" item-responsive responsive="screen">
      <n-grid-item span="12 m:12 l:9 xl:9 2xl:9">
        <div class="player">
          <Artplayer class="art-player" @get-instance="getInstance" :option="setting" :style="ArtplayerStyle"/>
        </div>

        <div class="showContainer watch-info">
          <div class="data-header">
            <div class="header-left">
              <div class="season-title">
                {{ playInfo.title }}
              </div>
            </div>
            <div class="header-right">
              <n-button @click="openDanmakuSearch" strong secondary><template #icon><i class="bx bx-message-dots"></i></template>弹幕</n-button>
              <n-button @click="openSubtitleSearch" strong secondary><template #icon><i class="bx bx-captions"></i></template>字幕</n-button>
              <n-button @click="showSetUp = !showSetUp;art.pause()" title="播放设置" aria-label="播放设置" strong secondary circle>
                <i class='bx bx-cog'></i>
              </n-button>
              <n-button @click="openExternalPlayback" title="更多播放方式" aria-label="更多播放方式" strong secondary circle>
                <i class='bx bx-dots-vertical-rounded'></i>
              </n-button>
            </div>
          </div>
          <div class="data-content">
            <div class="overview-text">
              简介：
              <p>{{ playInfo.overview }}</p>
            </div>
          </div>
        </div>

      </n-grid-item>
    </n-grid>
  </div>

  <n-modal v-model:show="showDanmakuSearch" title="搜索与选择弹幕" preset="card"
           :style="{width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto'}">
    <n-space vertical :size="16">
      <n-text>当前集：{{ playInfo?.title }}<span v-if="playInfo?.episode_number"> · 第 {{ playInfo.episode_number }} 集</span></n-text>
      <n-input v-model:value="danmakuKeyword" placeholder="输入片名、别名，或粘贴具体集数的平台播放链接" :disabled="danmakuBusy" @keyup.enter="searchDanmaku" />
      <n-space :wrap="false">
        <n-select v-model:value="danmakuSearchSource" :options="[{label: '360影视', value: '360'}, {label: '豆瓣', value: 'douban'}]"
                  :disabled="danmakuBusy" style="width: 150px" />
        <n-button type="primary" @click="searchDanmaku" :loading="danmakuBusy" :disabled="!danmakuKeyword.trim()">查询弹幕来源</n-button>
      </n-space>
      <n-text depth="3">先选择平台，再确认对应集数；保存仅替换当前集的弹幕来源。平台无资源或无弹幕时，可换来源或粘贴具体集数链接。</n-text>
      <n-alert v-if="danmakuSearchError" type="error" :show-icon="false">{{ danmakuSearchError }}</n-alert>
      <n-empty v-if="danmakuSearchDone && !danmakuResults.length" description="未找到来源，请尝试别名、切换搜索来源或粘贴播放链接" />
      <div v-if="danmakuEpisodes.length" style="padding: 12px; border: 1px solid #8885; border-radius: 6px">
        <div style="margin-bottom: 8px">{{ danmakuSelectedSource?.title }} · {{ danmakuSelectedSource?.platform }}</div>
        <n-select v-model:value="danmakuSelectedEpisode" :options="danmakuEpisodeOptions" :disabled="danmakuBusy" />
        <n-button style="margin-top: 12px" type="primary" @click="useDanmakuEpisode" :loading="danmakuBusy">保存并加载到当前集</n-button>
      </div>
      <div v-for="(result, index) in danmakuResults" :key="result.url + index" style="padding: 12px; border: 1px solid #8885; border-radius: 6px">
        <n-space justify="space-between" align="center">
          <div>{{ result.title }}<span v-if="result.season"> · 第 {{ result.season }} 季</span> · {{ result.platform }}</div>
          <n-button @click="chooseDanmakuSource(result)" :disabled="danmakuBusy">选择集数</n-button>
        </n-space>
      </div>
    </n-space>
  </n-modal>

  <n-modal v-model:show="showSubtitleSearch" title="搜索与选择字幕" preset="card"
           :style="{width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto'}">
    <n-space vertical :size="16">
      <n-text depth="3">ASS / SSA 默认保留字体、定位和动画。若设备渲染异常，可在播放器设置中关闭“ASS 特效字幕”；普通字幕大小滑块不覆盖 ASS 原始样式。</n-text>
      <n-alert v-if="subtitlePlaybackError" type="warning" :show-icon="false">{{ subtitlePlaybackError }}</n-alert>
      <div>
        <div style="margin-bottom: 8px">现有字幕</div>
        <n-space :wrap="false">
          <n-select v-model:value="subtitleTrackGuid" :options="subtitleTrackChoices" style="min-width: 220px; flex: 1"
                    :disabled="subtitleDownloadBusy" />
          <n-button @click="reloadSelectedSubtitle" :disabled="subtitleDownloadBusy">应用 / 重新加载</n-button>
        </n-space>
      </div>
      <div>查询当前影片：{{ playInfo?.title }}<span v-if="playInfo?.episode_number"> · 第 {{ playInfo.episode_number }} 集</span></div>
      <n-text depth="3">按当前影片匹配飞牛在线字幕，可选择语言查询，再筛选文件名。下载后会添加到该影片。</n-text>
      <n-space :wrap="false">
        <n-select v-model:value="subtitleSearchLanguage" :options="subtitleSearchLanguages" style="width: 140px"
                  :disabled="subtitleSearchBusy || subtitleDownloadBusy" />
        <n-button type="primary" @click="searchSubtitles" :loading="subtitleSearchBusy" :disabled="subtitleDownloadBusy">查询字幕</n-button>
      </n-space>
      <n-input v-model:value="subtitleSearchFilter" clearable placeholder="筛选结果中的文件名，例如简中、双语或版本名" />
      <n-alert v-if="subtitleSearchError" type="error" :show-icon="false">{{ subtitleSearchError }}</n-alert>
      <n-empty v-if="subtitleSearchDone && !filteredSubtitleResults.length" :description="subtitleResults.length ? '没有符合筛选条件的字幕' : '未找到字幕，可切换语言后重新查询'" />
      <div v-for="result in filteredSubtitleResults" :key="result.key" style="padding: 12px; border: 1px solid #8885; border-radius: 6px">
        <div style="overflow-wrap: anywhere; margin-bottom: 8px">{{ result.filename }}</div>
        <n-space justify="space-between" align="center">
          <n-text depth="3">{{ result.format || '字幕' }}<span v-if="result.language || result.lan"> · {{ result.language || result.lan }}</span></n-text>
          <n-button @click="useSearchedSubtitle(result)" :loading="subtitleDownloadBusy"
                    :disabled="subtitleSearchBusy || !result.trimId || !['SRT','SUBRIP','ASS','SSA','VTT','WEBVTT'].includes(result.format)">
            {{ result.existingGuid ? '选择并使用' : '下载并使用' }}
          </n-button>
        </n-space>
      </div>
    </n-space>
  </n-modal>

  <n-modal v-model:show="showSetUp" title="跳过时间段整季可用，平台链接当前集可用" preset="dialog" draggable="true"
           :style="{ width: '30em', maxHeight: '30em', overflowY: 'auto' }">
    <n-form ref="formRef" :model="seasonConfig">
      <n-form-item path="age" label="跳过开始时间/跳过结束时间">
        <n-dynamic-input
            v-model:value="seasonConfig.list"
            placeholder="请输入跳过时间段"
            :on-create="dynamicInputCreateBySkipTime"
        >
          <template #default="{ value }">
            <div style="display: flex; align-items: center; width: 100%">
              <n-input-number
                  v-model:value="value.startTime"
                  style="margin-right: 12px; width: 160px"
                  placeholder="请输入跳过开始时间"
              />
              <n-input-number
                  v-model:value="value.endTime"
                  style="margin-right: 12px; width: 160px"
                  placeholder="请输入跳过结束时间"
              />
            </div>
          </template>
        </n-dynamic-input>
      </n-form-item>
      <n-form-item label="平台链接">
        <n-dynamic-input
            v-model:value="seasonConfig.url"
            placeholder="请输入平台链接"
            :on-create="dynamicInputCreateByUrl"
        >
          <template #default="{ value }">
            <div style="display: flex; align-items: center; width: 100%">
              <n-input
                  v-model:value="value.url"
                  style="margin-right: 12px;"
                  placeholder="请输入平台链接"
              />
            </div>
          </template>
        </n-dynamic-input>
      </n-form-item>
    </n-form>

    <template #action>
      <n-button @click="putVideoConfig">确认</n-button>
      <n-button @click="showSetUp = false">取消</n-button>
    </template>
  </n-modal>
  <n-modal transform-origin="center" v-model:show="showModal">
    <n-card :style="{width: 'min(600px, 94vw)'}" title="外部播放器" :bordered="false"
            size="huge" role="dialog" aria-modal="true">
      <template #header-extra>
        <n-button @click="showModal = !showModal" strong secondary circle>
          <i class='bx bx-x'></i>
        </n-button>
      </template>
      <p>临时播放链接有效期 4 小时，播放期间请保留本网页。服务重启后请重新获取链接。</p>
      <p v-if="externalBusy" role="status">正在准备外部播放链接…</p>
      <div v-else-if="externalError" role="alert">
        <p>{{ externalError }}</p><n-button @click="openExternalPlayback">重新获取链接</n-button>
      </div>
      <div v-else-if="externalMediaUrl">
        <p>PotPlayer：下载下方播放列表后用播放器打开，或复制 HTTP 地址，在 PotPlayer 按 Ctrl+U 粘贴播放。</p>
        <n-input :value="externalMediaUrl" readonly aria-label="外部播放器 HTTP 媒体地址" @focus="event => event.target.select?.()" />
      </div>
      <ul v-if="externalMediaUrl && !externalBusy && !externalError" class="play-list">
        <li class="play-item">
          <a :href="externalHref('iina')">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/iina.webp" alt="">
              </template>
              IINA
            </n-tooltip>
          </a>
        </li>
        <li class="play-item">
          <a :href="externalPlaylistUrl" download="fnos-tv-playlist.m3u" aria-label="下载 PotPlayer 播放列表">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/potplayer.webp" alt="">
              </template>
              PotPlayer 播放列表
            </n-tooltip>
          </a>
        </li>
        <li class="play-item">
          <a :href="externalHref('vlc')">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/vlc.webp" alt="">
              </template>
              VLC
            </n-tooltip>
          </a>
        </li>
        <li class="play-item">
          <a :href="externalHref('nplayer')">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/nplayer.webp" alt="">
              </template>
              nplayer
            </n-tooltip>
          </a>
        </li>
        <li class="play-item">
          <a :href="externalHref('infuse')">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/infuse.webp" alt="">
              </template>
              infuse
            </n-tooltip>
          </a>
        </li>
        <li class="play-item">
          <a :href="externalHref('mxplayer')">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/mxplayer.webp" alt="">
              </template>
              Mxplayer
            </n-tooltip>
          </a>
        </li>
        <li class="play-item">
          <a :href="externalHref('mxplayer-pro')">
            <n-tooltip trigger="hover">
              <template #trigger>
                <img class="play-icon" src="/images/mxplayer-pro.webp" alt="">
              </template>
              Mxplayer-Pro
            </n-tooltip>
          </a>
        </li>
      </ul>
    </n-card>
  </n-modal>

</template>


<style scoped>
h1 {
  padding: auto;
}


.player .art-player {
  background-color: black;
  width: 100%;
  aspect-ratio: 16/9;
}

.data-content {
  font-size: 16px;
}

.data-title {
  font-size: 1.4em;
  margin-bottom: 6px;
  font-weight: 500;
}

.season-title {
  font-size: 1.2em;
  margin-bottom: 4px;
}

.showContainer {
  padding-top: 8px;
  padding-bottom: 8px;
}

.show-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.data-header {
  display: flex;
  justify-content: space-between;
}

.show-card-list {
  display: flex;
  gap: 20px;
}

.show-title {
  font-size: 1.2em;
}

.show-img img {
  border-radius: 4px;
  width: 160px;
  aspect-ratio: 11/16;
}

.show-name {
  width: 160px;
  text-overflow: ellipsis;
  overflow: hidden;
}


.view-card-list {
  justify-content: space-between;
  display: flex;
  gap: 20px;
}

.view-card-list img {
  border-radius: 4px;
  width: 160px;
  aspect-ratio: 11/16;
}

.card-show-title {
  font-size: 1.2em;
  font-weight: 400;
  padding-bottom: 16px;
}

.view-item-title {
  font-size: 1.2em;
  padding-bottom: 8px;
}

.card-shows {
  margin-bottom: 20px;
}

.view-item {
  text-align: center;
}


.view-card-list .view-item {
  transform: translateY(0) scale(1);
  transition: all .2s ease-in-out;
}

.view-card-list .view-item:hover {
  transform: translateY(-4px) scale(0.95);
  transition: all .2s ease-in-out;
}

.view-item-header {
  position: absolute;
  width: 95%;
  padding-left: 4px;
}


.view-item-tag-list {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-item-tag-list .count {
  background-color: #2d8cf0 !important;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  color: white;
  padding: 4px;
  text-align: center;
}

.rating {
  color: yellow;
}

.show_like .show-item img {
  width: 120px;
  aspect-ratio: 9/12;
  border-radius: 2px;
}

.show_like .show-item {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}


.episode-card-item {
  display: flex;
  gap: 10px;
}

.episode-card-list img {
  width: 100%;
  max-width: 400px;
  min-width: 200px;
  max-height: 120px;
  aspect-ratio: 12/9;
}

.episode-card-list .episode-overview,
.view-item-overview {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.play-list {
  margin: 0;
  padding: 0;
  display: flex;
  justify-content: space-around;
}

.play-list .play-item {

  list-style: none;
}

img.play-icon {
  width: 60px;
  height: 60px;
}

.art-video-player .art-mask .art-state {
  position: absolute;
  bottom: 65px;
  right: 30px;
}

@media (max-width: 767px) {
  img.play-icon {
    width: 40px;
    height: 40px;
  }
}

/* 移动端适配样式 */
@media (max-width: 768px) {
  .player .art-player {
    height: 56.25vw;
    max-height: calc(100vh - 100px);
  }

  .data-header {
    flex-direction: column;
    gap: 8px;
  }

  .header-right {
    display: flex;
    gap: 8px;
  }

  .data-content {
    font-size: 14px;
  }

  .season-title {
    font-size: 1.1em;
  }

  /* 调整外部播放器列表布局 */
  .play-list {
    flex-wrap: wrap;
    gap: 16px;
    justify-content: flex-start;
  }

  .play-list .play-item {
    width: calc(33.33% - 16px);
    text-align: center;
  }

  img.play-icon {
    width: 48px;
    height: 48px;
  }

  /* 调整弹幕标题样式 */
  :deep(.art-title) {
    font-size: 14px !important;
    padding: 2px 6px !important;
  }

  /* 调整设置弹窗宽度 */
  :deep(.n-modal) {
    width: 90vw !important;
    max-width: 30em;
  }

}

/* 超小屏幕适配 */
@media (max-width: 480px) {
  .play-list .play-item {
    width: calc(50% - 16px);
  }

  img.play-icon {
    width: 40px;
    height: 40px;
  }


}
</style>

<script setup>
import flvjs from 'flv.js';
import Hls from 'hls.js';
import {computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import Artplayer from "./ArtPlayer.vue";
import {onBeforeRouteLeave, onBeforeRouteUpdate} from "vue-router";
import VueCookies from "vue-cookies";
import sortedIndexBy from 'lodash-es/sortedIndexBy'
import artplayerPluginDanmuku from "artplayer-plugin-danmuku";
import axios from "axios";
import {createBlobVTTUrl, SegmentedSubtitleLoader, subtitleOptions, bindSubtitleTrack, subtitleSearchResults, downloadSubtitle, isPgsSubtitle, streamSubtitleGuid} from "./subtitle.js"
import {episodeDanmaku, errorText} from '../../compat.js';
import {SubtitleOverlay, waitForAssSubtitle} from './ass-renderer.js';
import {playbackTitle, playbackSelection, nextEpisode, previousEpisode} from './player-presentation.js';
import {renderDanmaku} from './danmaku-renderer.js';
import {PlaybackSession, createProgressReporter} from './playback-session.js';
import {loadPlaybackMetadata, primaryMediaFile} from './playback-metadata.js';
import {mediaFileLabel} from './media-files.js';
import {shiftVtt, localSubtitleVtt, MAX_LOCAL_SUBTITLE_BYTES} from './subtitle-adjustments.js';
import {playbackDiagnostics} from './playback-diagnostics.js';
import PlaybackRecoveryCard from './PlaybackRecoveryCard.vue';
import DanmakuSourcesDialog from './DanmakuSourcesDialog.vue';
import {isPlaybackAbort, playbackFailureMessage, lowerPlaybackQuality, switchRecoverableSource, bufferedPlaybackFailure} from './playback-recovery.js';
import {chooseAudio, audioLabel, createAutoplayCountdown} from './audio-tracks.js';
import {createPlayerPreferenceStore} from './player-preferences.js';
import {GESTURE_HOLD_RATES} from './gesture-settings.js';
import {QUALITY_PREFERENCES, choosePreferredSubtitle, choosePreferredQuality, qualityPreferenceFallback, subtitleLanguageChoices, subtitleLanguageLabel} from './media-preferences.js';
import {useBrowseSnapshots} from '../../store.js';
const playbackSession = new PlaybackSession();
import {installMobileFullscreen} from './mobile-fullscreen.js';
import {installMobileDanmaku} from './mobile-danmaku.js';
import {backIcon, fullscreenIcon, fullscreenExitIcon} from './player-icons.js';
import {exitPlayerFullscreen, installMobileGestures, installPlaybackNoticeFilter} from './player-interactions.js';
let disposeMobileGestures = () => {};
let disposePlaybackNotices = () => {};
import {installDesktopIdle} from './desktop-idle.js';
let disposeDesktopIdle = () => {};
import {externalPlayerLink, externalPlaylist, externalPlayerChoices} from './external-player.js';
import {createExternalSession} from './external-session.js';
import {replaceMediaEngine, releaseMediaEngine, isCurrentMediaEngine, currentMediaEngine} from './media-lifecycle.js';
let disposeMobileDanmaku = () => {};
const touchPlayer = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
let disposeMobileFullscreen = () => {};

const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
const device = proxy.$device;
const accountState = useBrowseSnapshots();
const playerPreferences = createPlayerPreferenceStore();
let preferenceHandle = playerPreferences.bindAccount(accountState.account);
let preferenceWarningShown = false;
let preferenceResetGeneration = 0;
function savePlayerPreference(name, value, handle = preferenceHandle) {
  const result = handle.write(name, value);
  if (result.accepted && !result.persisted && !preferenceWarningShown) {
    preferenceWarningShown = true;
    COMMON.ShowMsg('播放设置仅对本次有效，浏览器未能保存；刷新后可能恢复原值');
  }
  return result.accepted;
}
const currentAudio = ref(null);
const preferredAudioLanguage = ref(preferenceHandle.read('audioLanguage'));
const autoPlayNext = ref(preferenceHandle.read('autoPlayNext'));
const gesturesEnabled = ref(preferenceHandle.read('gesturesEnabled'));
const gestureHoldRate = ref(preferenceHandle.read('gestureHoldRate'));
const preferredSubtitleLanguage = ref(preferenceHandle.read('subtitleLanguage'));
const preferredQuality = ref(preferenceHandle.read('qualityPreference'));
const preferredExternalPlayer = ref(preferenceHandle.read('externalPlayer'));
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
const allMediaStreams = ref(null);
const showMediaFiles = ref(false);
const selectedMediaGuid = ref(null);
const mediaFileResume = ref(false);
const mediaFileBusy = ref(false);
const mediaFileOptions = computed(() => (allMediaStreams.value?.files || []).map(file => ({value: file.guid,
  label: mediaFileLabel(file, allMediaStreams.value)})));
const selectedMediaLabel = computed(() => mediaFileOptions.value.find(file => file.value === StreamList.value?.selected_media_guid)?.label || '当前文件');
async function openMediaFiles() {
  selectedMediaGuid.value = StreamList.value?.selected_media_guid;
  mediaFileResume.value = false;
  if (art) art.setting.show = false;
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  showMediaFiles.value = true;
}
async function applyMediaFile() {
  if (mediaFileBusy.value || !selectedMediaGuid.value) return;
  const owner = preferenceHandle;
  if (selectedMediaGuid.value === StreamList.value?.selected_media_guid) { showMediaFiles.value = false; return; }
  const position = mediaFileResume.value ? Math.max(0, Number(art?.currentTime) || 0) : 0;
  const paused = art?.video?.paused ?? true;
  void SendPlayRecord();
  mediaFileBusy.value = true;
  try {
    await play({mediaGuid: selectedMediaGuid.value, position, paused});
    if (owner.isCurrent()) showMediaFiles.value = false;
  } catch (error) { if (owner.isCurrent() && !isPlaybackAbort(error)) COMMON.ShowMsg(errorText(error)); }
  finally { mediaFileBusy.value = false; }
}
const showDiagnostics = ref(false);
const diagnosticText = ref('');
function refreshDiagnostics() {
  diagnosticText.value = JSON.stringify(playbackDiagnostics({video: art?.video, engine: art ? currentMediaEngine(art) : null,
    videoTrack: StreamList.value?.video_streams?.[0], audioTrack: currentAudio.value, quality: currentQuality.value,
    subtitleMode: subtitleRenderMode.value, failure: recoveryState.value, use302: use_302_play.value}), null, 2);
}
function openDiagnostics() {
  if (art) art.setting.show = false;
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  refreshDiagnostics(); showDiagnostics.value = true;
}
async function copyDiagnostics() {
  try { await navigator.clipboard.writeText(diagnosticText.value); COMMON.ShowMsg('已复制脱敏诊断'); }
  catch { COMMON.ShowMsg('浏览器未允许复制，请选中文本手动复制'); }
}
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
const preferExternalFile = /Windows/i.test(navigator.userAgent);
let externalSessionLink = '', externalGeneration = 0, externalController = null;
function releaseExternalSession() {
  externalGeneration++;
  externalController?.abort();
  externalController = null;
  if (externalSessionLink) void mediaP('media.quit', externalSessionLink).catch(() => {});
  externalSessionLink = '';
}
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
const externalChoices = externalPlayerChoices(navigator.userAgent, navigator.maxTouchPoints);
const effectiveExternalPlayer = computed(() => externalChoices.find(item => item.value === preferredExternalPlayer.value)?.value || '');
const preferredExternalLabel = computed(() => externalChoices.find(item => item.value === effectiveExternalPlayer.value)?.label || '每次选择');
const preferredExternalHref = computed(() => !externalMediaUrl.value || !effectiveExternalPlayer.value ? ''
  : effectiveExternalPlayer.value === 'potplayer' ? externalPlaylistUrl.value : externalHref(effectiveExternalPlayer.value));
async function openExternalPlayback(snapshot = null) {
  if (externalBusy.value) return;
  const selection = snapshot?.episode === episode_guid.value ? snapshot : null;
  const position = selection?.position ?? (playInfo.value?.guid === episode_guid.value ? art?.currentTime : null);
  art?.pause();
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  showModal.value = true;
  externalMediaUrl.value = '';
  externalError.value = '';
  externalBusy.value = true;
  const episode = episode_guid.value;
  releaseExternalSession();
  const generation = externalGeneration;
  const controller = externalController = new AbortController();
  const current = () => generation === externalGeneration && episode === episode_guid.value && !controller.signal.aborted;
  try {
    if (use_302_play.value && url.value !== COMMON.fnHost + urlBase.value) {
      const direct = new URL(playUrl.value, window.location.origin);
      if (!['http:', 'https:'].includes(direct.protocol)) throw new Error('无效的媒体地址');
      externalMediaUrl.value = direct.href;
      return;
    }
    const source = await createExternalSession(COMMON.requests, episode, {
      signal: controller.signal, position, quality: selection?.quality || currentQuality.value,
      audioGuid: selection?.audioGuid ?? currentAudio.value?.guid,
      subtitleGuid: selection?.subtitleGuid ?? currentSubtitle.value?.guid ?? '', maxAudioChannels: device.mediaCanPlay.audioChannels,
      preferFile: preferExternalFile,
      mediaGuid: StreamList.value?.selected_media_guid,
    });
    if (!current()) { if (source.play_link) void mediaP('media.quit', source.play_link).catch(() => {}); return; }
    externalSessionLink = source.play_link || '';
    const response = await axios.post('/danmu/external-play', source, {
      signal: controller.signal,
      headers: {Authorization: VueCookies.get('authorization') || ''}
    });
    if (!current() || !showModal.value) return;
    if (response.data?.code !== 0 || !response.data.data?.url) throw new Error(response.data?.msg || '外部播放链接获取失败');
    externalMediaUrl.value = new URL(response.data.data.url, window.location.origin).href;
  } catch (error) {
    if (current()) {
      externalError.value = error.response?.data?.msg || '外部播放链接准备失败，请重新获取链接';
      if (externalSessionLink) { void mediaP('media.quit', externalSessionLink).catch(() => {}); externalSessionLink = ''; }
    }
  } finally { if (current()) externalBusy.value = false; }
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
const showDanmakuSources = ref(false);
const danmakuSourceConfig = ref(null);
const activeDanmakuSource = ref('');
const danmakuApplyScope = ref('episode');
let danmakuRequestController = new AbortController();
let danmakuQueryGeneration = 0;
function cancelDanmakuRequests() {
  danmakuRequestController.abort(); danmakuRequestController = new AbortController();
  danmakuQueryGeneration++; danmakuBusy.value = false;
}
const danmakuSearchChoices = computed(() => {
  if (!danmakuSourceConfig.value) return [{label: '360影视', value: '360'}, {label: '豆瓣', value: 'douban'}];
  return ['searches', 'custom'].flatMap(kind => (danmakuSourceConfig.value[kind] || []).filter(row => row.enabled).map(row => ({label: row.name, value: row.id})));
});
const activeDanmakuSourceName = computed(() => ['providers','custom'].flatMap(key => danmakuSourceConfig.value?.[key] || []).find(row => row.id === activeDanmakuSource.value)?.name || activeDanmakuSource.value || '尚未选择');
async function loadDanmakuSourceConfig() {
  const owner = preferenceHandle;
  const generation = danmakuQueryGeneration;
  try {
    const result = await danmakuRequest('/danmu/sources');
    if (!owner.isCurrent() || generation !== danmakuQueryGeneration) return;
    danmakuSourceConfig.value = result.data;
    if (!danmakuSearchChoices.value.some(row => row.value === danmakuSearchSource.value)) danmakuSearchSource.value = danmakuSearchChoices.value[0]?.value || '';
  } catch (error) { if (owner.isCurrent() && error.name !== 'AbortError') danmakuSearchError.value = errorText(error); }
}
function openDanmakuSources() {
  if (art) art.setting.show = false;
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  showDanmakuSources.value = true;
}
async function reloadDanmakuSources() {
  const owner = preferenceHandle;
  cancelDanmakuRequests(); danmakuLoadGeneration++;
  const generation = danmakuLoadGeneration;
  danmakuResults.value = []; danmakuEpisodes.value = [];
  if (art) await applyDanmakuRows([], playInfo.value?.episode_number ?? 1);
  if (!owner.isCurrent() || generation !== danmakuLoadGeneration) return;
  await loadDanmakuSourceConfig();
  if (owner.isCurrent() && generation === danmakuLoadGeneration && art) await loadDanmuku();
}
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
  const response = await fetch(path, {signal: path.startsWith('/danmu/subtitle-') ? undefined : danmakuRequestController.signal, ...options, headers: {
    Authorization: VueCookies.get('authorization') || '',
    ...(options.body ? {'Content-Type': 'application/json'} : {})
  }});
  const data = await response.json();
  if (!response.ok || (data?.code !== undefined && data.code !== 0))
    throw new Error(data?.msg || `弹幕服务返回 HTTP ${response.status}`);
  return data;
}
function openDanmakuSearch() {
  if (art) art.setting.show = false;
  if (art?.fullscreen) art.fullscreen = false;
  if (art?.fullscreenWeb) art.fullscreenWeb = false;
  danmakuKeyword.value = playInfo.value?.tv_title || playInfo.value?.title || '';
  showDanmakuSearch.value = true;
  void loadDanmakuSourceConfig();
}
async function searchDanmaku() {
  if (danmakuBusy.value) return;
  const episodeGuid = episode_guid.value;
  const query = ++danmakuQueryGeneration;
  danmakuBusy.value = true;
  danmakuSearchError.value = '';
  danmakuSearchDone.value = false;
  danmakuEpisodes.value = [];
  danmakuSelectedSource.value = null;
  try {
    const data = await danmakuRequest('/danmu/search?' + new URLSearchParams({
      keyword: danmakuKeyword.value.trim(), source: danmakuSearchSource.value
    }));
    if (episodeGuid !== episode_guid.value || query !== danmakuQueryGeneration) return;
    danmakuResults.value = data.results || [];
    danmakuSearchDone.value = true;
  } catch (error) { if (episodeGuid === episode_guid.value && query === danmakuQueryGeneration && error.name !== 'AbortError') danmakuSearchError.value = errorText(error); }
  finally { if (query === danmakuQueryGeneration) danmakuBusy.value = false; }
}
async function chooseDanmakuSource(source) {
  if (danmakuBusy.value) return;
  const episodeGuid = episode_guid.value;
  const query = ++danmakuQueryGeneration;
  danmakuBusy.value = true;
  danmakuSearchError.value = '';
  danmakuEpisodes.value = [];
  danmakuSelectedSource.value = source;
  try {
    const data = await danmakuRequest('/danmu/episodes?' + new URLSearchParams({url: source.url}));
    if (episodeGuid !== episode_guid.value || query !== danmakuQueryGeneration) return;
    danmakuEpisodes.value = data.episodes || [];
    const matched = danmakuEpisodes.value.findIndex(e => String(e.number) === String(playInfo.value.episode_number ?? 1));
    danmakuSelectedEpisode.value = matched < 0 ? 0 : matched;
  } catch (error) { if (episodeGuid === episode_guid.value && query === danmakuQueryGeneration && error.name !== 'AbortError') danmakuSearchError.value = errorText(error); }
  finally { if (query === danmakuQueryGeneration) danmakuBusy.value = false; }
}
async function applyDanmakuRows(rows, episodeNumber) {
  const player = art, generation = danmakuLoadGeneration;
  if (!player) return;
  // load() 不带参数会清空旧队列；带数组则是追加，不能用 load([]) 清空。
  const plugin = player.plugins.artplayerPluginDanmuku;
  plugin.config({danmuku: []});
  await plugin.load();
  if (player !== art || generation !== danmakuLoadGeneration) return;
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
    const mapping = {};
    if (danmakuApplyScope.value === 'season') for (const row of danmakuEpisodes.value) {
      if (/^\d{1,5}$/.test(String(row.number)) && !Object.hasOwn(mapping, String(row.number))) mapping[String(row.number)] = row.url;
    }
    if (danmakuApplyScope.value === 'season' && !Object.keys(mapping).length) throw new Error('当前来源没有可靠分集编号，只能应用当前集');
    await danmakuRequest('/danmu/sources/preferences', {method: 'PUT', body: JSON.stringify({
      scope: danmakuApplyScope.value, guid: episodeGuid, parent_guid: parentGuid, url: selected.url,
      source_id: danmakuSelectedSource.value?.source_id || 'auto', fallback: false,
      ...(danmakuApplyScope.value === 'season' ? {episodes: mapping} : {})
    })});
    if (episodeGuid !== episode_guid.value || generation !== danmakuLoadGeneration) return;
    await applyDanmakuRows(rows, episodeNumber);
    if (episodeGuid !== episode_guid.value || generation !== danmakuLoadGeneration) return;
    await getVideoConfig();
    if (episodeGuid !== episode_guid.value || generation !== danmakuLoadGeneration) return;
    void GetEmoji(danmakuSelectedSource.value?.source_id || '');
    activeDanmakuSource.value = danmakuSelectedSource.value?.source_id || '';
    COMMON.ShowMsg(`个人${danmakuApplyScope.value === 'season' ? '季度' : '单集'}来源已保存，加载 ${rows.length} 条弹幕`);
  } catch (error) { if (episodeGuid === episode_guid.value && generation === danmakuLoadGeneration && error.name !== 'AbortError') danmakuSearchError.value = errorText(error); }
  finally { if (generation === danmakuLoadGeneration) danmakuBusy.value = false; }
}
const currentSubtitle = ref(null);
const subtitleOffset = ref(0);
const subtitleBottom = ref(10);
const subtitleOutline = ref(2);
let rawSubtitleText = '', localSubtitleText = '';
const localSubtitleName = ref('');
function applySubtitleAppearance() {
  art?.subtitle.style({bottom: `${subtitleBottom.value}%`, textShadow: subtitleOutline.value
    ? `0 0 ${subtitleOutline.value}px #000, 1px 1px ${subtitleOutline.value}px #000, -1px -1px ${subtitleOutline.value}px #000` : 'none'});
}
async function setSubtitleOffset(value) {
  subtitleOffset.value = Math.max(-60, Math.min(60, Number(value) || 0));
  assRenderer.setOffset(subtitleOffset.value); pgsRenderer.setOffset(subtitleOffset.value);
  if (subtitleRenderMode.value === 'text' && rawSubtitleText) await subtitleLoader.render(rawSubtitleText);
}
async function importLocalSubtitle(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  const owner = preferenceHandle, episode = episode_guid.value, media = StreamList.value?.selected_media_guid;
  const generation = ++subtitleSearchGeneration;
  try {
    if (file.size > MAX_LOCAL_SUBTITLE_BYTES) throw new Error('字幕文件超过 2 MB');
    const text = localSubtitleVtt(await file.text(), file.name);
    if (!owner.isCurrent() || generation !== subtitleSearchGeneration || episode !== episode_guid.value || media !== StreamList.value?.selected_media_guid) return;
    await switchSubtitle({guid: null, index: -1, html: '关闭字幕'});
    if (!owner.isCurrent() || generation !== subtitleSearchGeneration || episode !== episode_guid.value || media !== StreamList.value?.selected_media_guid) return;
    localSubtitleText = text; localSubtitleName.value = file.name;
    currentSubtitle.value = {guid: '', local: true}; subtitleRenderMode.value = 'text';
    await subtitleLoader.render(text);
    COMMON.ShowMsg('本地字幕已加载，仅在当前页面使用，不上传服务器');
  } catch (error) { if (owner.isCurrent()) COMMON.ShowMsg(errorText(error)); }
}
let serverSubtitleGuid = null;
let subtitleSwitchGeneration = 0;
const useAssSubtitles = ref(preferenceHandle.read('assSubtitles'));
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
const subtitleFontSize = ref(preferenceHandle.read('subtitleFontSize'));
function setSubtitleFontSize(value, {persist = true, handle = preferenceHandle} = {}) {
  if (!handle.isCurrent()) return `${subtitleFontSize.value}px`;
  subtitleFontSize.value = Math.min(60, Math.max(12, Math.round(Number(value) || 20)));
  if (art) art.subtitle.style({fontSize: `${subtitleFontSize.value}px`});
  if (persist) savePlayerPreference('subtitleFontSize', subtitleFontSize.value, handle);
  return `${subtitleFontSize.value}px`;
}
const use_302_play = ref(preferenceHandle.read('use302'));
const showPreferenceReset = ref(false);
const preferenceResetTarget = shallowRef(null);
const preferenceResetBusy = ref(false);
let preferenceResetOwner = null;
let preferenceResetVersion = 0;
function loadPlayerPreferences({streamChanges = true} = {}) {
  preferredAudioLanguage.value = preferenceHandle.read('audioLanguage');
  autoPlayNext.value = preferenceHandle.read('autoPlayNext');
  gesturesEnabled.value = preferenceHandle.read('gesturesEnabled');
  gestureHoldRate.value = preferenceHandle.read('gestureHoldRate');
  preferredSubtitleLanguage.value = preferenceHandle.read('subtitleLanguage');
  preferredQuality.value = preferenceHandle.read('qualityPreference');
  preferredExternalPlayer.value = preferenceHandle.read('externalPlayer');
  setSubtitleFontSize(preferenceHandle.read('subtitleFontSize'), {persist: false});
  if (streamChanges) {
    useAssSubtitles.value = preferenceHandle.read('assSubtitles');
    use_302_play.value = preferenceHandle.read('use302');
  }
}
function requestPlayerPreferenceReset(owner = preferenceHandle, version = preferenceResetGeneration) {
  if (!owner.isCurrent() || version !== preferenceResetGeneration) return;
  preferenceResetOwner = owner;
  preferenceResetVersion = version;
  preferenceResetTarget.value = art?.fullscreen || art?.fullscreenWeb ? art.template.$player : null;
  if (art) art.setting.show = false;
  showPreferenceReset.value = true;
}
async function confirmPlayerPreferenceReset() {
  const owner = preferenceResetOwner;
  if (preferenceResetBusy.value || owner !== preferenceHandle || !owner?.isCurrent()
      || preferenceResetVersion !== preferenceResetGeneration) {
    showPreferenceReset.value = false;
    return;
  }
  preferenceResetBusy.value = true;
  try {
    const result = owner.reset();
    if (!result.accepted) return;
    preferenceResetGeneration++;
    disposeMobileGestures.refresh?.();
    loadPlayerPreferences({streamChanges: false});
    disposeMobileGestures.refresh?.();
    const player = art;
    if (player) player.playbackRate = owner.read('playbackRate');
    autoplayCountdown.cancel();
    showPreferenceReset.value = false;
    COMMON.ShowMsg(result.persisted
      ? '已恢复播放偏好；音轨、字幕、默认画质和 302 将在重新打开影片或切集时生效'
      : '本次已恢复默认，但浏览器未能完整保存；刷新后可能恢复原值');
    if (player) await UpdateControl(player);
  } catch {
    if (owner === preferenceHandle && owner.isCurrent()) COMMON.ShowMsg('偏好重置后菜单未能更新，请重新打开播放器');
  } finally { preferenceResetBusy.value = false; }
}
let currentVttBlob = null;
let subtitleErrorShown = false;
const subtitleLoader = new SegmentedSubtitleLoader({
  getTime: () => Math.max(0, (art?.currentTime || 0) - subtitleOffset.value),
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
    rawSubtitleText = '';
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
    rawSubtitleText = text;
    const next = createBlobVTTUrl(shiftVtt(text, subtitleOffset.value));
    const previous = currentVttBlob;
    currentVttBlob = next;
    await art.subtitle.switch(next, {type: 'vtt', encoding: 'utf-8'});
    applySubtitleAppearance();
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

const recoveryState = ref(null);
const recoveryBusy = ref(false);
const recoveryTarget = shallowRef(null);
let sourceEpisode = null, sourcePosition = null, sourcePaused = false, sourceTimer = null, recoveryRun = 0;
let bufferedRecovery = null;
const lowerRecoveryQuality = computed(() => playInfo.value?.guid === recoveryState.value?.episode
  ? lowerPlaybackQuality(QualityData.value, recoveryState.value?.quality) : null);
const lowerRecoveryLabel = computed(() => lowerRecoveryQuality.value
  ? `${lowerRecoveryQuality.value.resolution} / ${(lowerRecoveryQuality.value.bitrate / 1000000).toFixed(1)}Mbps` : '');
const canRecoverExternally = computed(() => Boolean(recoveryState.value?.episode && playInfo.value?.guid === recoveryState.value.episode && StreamList.value?.files?.length));

function clearPlaybackRecovery() {
  clearTimeout(sourceTimer);
  bufferedRecovery?.reset();
  recoveryState.value = null;
  playbackError.value = '';
}

function reportPlaybackFailure(error, snapshot = null) {
  if (isPlaybackAbort(error)) return;
  clearTimeout(sourceTimer);
  autoplayCountdown.cancel();
  const same = playInfo.value?.guid === episode_guid.value;
  const state = snapshot || recoveryState.value || {
    episode: episode_guid.value,
    mediaGuid: same ? StreamList.value?.selected_media_guid : undefined,
    position: sourceEpisode === episode_guid.value ? sourcePosition : null,
    paused: sourcePaused,
    audioGuid: same ? currentAudio.value?.guid : undefined,
    subtitleGuid: same ? currentSubtitle.value?.guid || '' : undefined,
    quality: same ? {...currentQuality.value} : null,
  };
  recoveryState.value = {...state, episode: episode_guid.value, message: playbackFailureMessage(error)};
  if (art) {
    art.pause();
    art.loading.show = false;
    art.controls.show = true;
  } else playbackError.value = recoveryState.value.message;
}

function watchPlaybackSource(player, source) {
  if (player !== art || source !== url.value) return false;
  player.fnosSourceGeneration = playbackSession.generation;
  sourceEpisode = episode_guid.value;
  sourcePosition = playInfo.value?.watched_ts ?? 0;
  clearTimeout(sourceTimer);
  const generation = playbackSession.generation;
  sourceTimer = setTimeout(() => {
    if (player === art && generation === playbackSession.generation) {
      player.emit('fnos:media-error', {code: 'PLAYBACK_TIMEOUT'});
    }
  }, 45000);
  return true;
}

async function recoverPlayback(mode = 'retry') {
  if (recoveryBusy.value || !recoveryState.value) return;
  const snapshot = {...recoveryState.value};
  if (mode === 'lower') {
    if (!lowerRecoveryQuality.value) return;
    snapshot.quality = {...lowerRecoveryQuality.value};
  }
  if (mode === 'external' && !canRecoverExternally.value) return;
  recoveryBusy.value = true;
  const run = ++recoveryRun;
  const initialization = initializationGeneration;
  const current = () => run === recoveryRun && initialization === initializationGeneration;
  try {
    // Initialization prerequisites can also have been the failing stage.
    if (!art) {
      await getVideoConfig();
      if (!current()) return;
      if (gallery_type.value !== 'Movie') await GetEpisodeList(initialization);
    }
    if (!current() || snapshot.episode !== episode_guid.value) return;
    if (mode === 'external') { await openExternalPlayback(snapshot); return; }
    await play(snapshot);
    if (!current() || (snapshot.episode && snapshot.episode !== episode_guid.value)) return;
    loading.value = false;
  } catch (error) {
    if (current() && (!snapshot.episode || snapshot.episode === episode_guid.value) && !isPlaybackAbort(error)) reportPlaybackFailure(error, snapshot);
  } finally {
    if (current()) recoveryBusy.value = false;
  }
}

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

let danmu_setting;
try { danmu_setting = JSON.parse(window.localStorage.getItem('danmu_setting'))?.value; } catch {}
if (!danmu_setting || typeof danmu_setting !== 'object' || Array.isArray(danmu_setting)) {
  danmu_setting = {
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
  };
}

const setting = ref({
  url: "",
  id: "",
  customType: {
    m3u8: function (video, url, player) {
      if (!watchPlaybackSource(player, url)) return;
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
      hls.on(Hls.Events.ERROR, (_event, error) => {
        if (error.fatal && isCurrentMediaEngine(player, hls) && player.fnosSourceGeneration === playbackSession.generation) {
          player.emit('fnos:media-error', {category: error.type === Hls.ErrorTypes.MEDIA_ERROR ? 'decode' : 'network'});
        }
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (isCurrentMediaEngine(player, hls)) player.emit('fnos:network-ready');
      });
      hls.loadSource(url)
      hls.attachMedia(video)
    },
    flv: function (video, url, player) {
      if (!watchPlaybackSource(player, url)) return;
      const flvPlayer = replaceMediaEngine(player, () => flvjs.createPlayer({
        type: 'flv',
        url: url
      }))
      flvPlayer.on(flvjs.Events.ERROR, type => {
        if (isCurrentMediaEngine(player, flvPlayer) && player.fnosSourceGeneration === playbackSession.generation) {
          player.emit('fnos:media-error', {category: type === flvjs.ErrorTypes.MEDIA_ERROR ? 'decode' : 'network'});
        }
      });
      flvPlayer.attachMediaElement(video)
      flvPlayer.load()
    },
    mkv: function (video, url, player) {
      if (!watchPlaybackSource(player, url)) return;
      releaseMediaEngine(player);
      video.src = url;
    },
    mp4: function (video, url, player) {
      if (!watchPlaybackSource(player, url)) return;
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
  const player = art;
  if (!player) return;
  const generation = ++danmakuLoadGeneration;
  const episodeGuid = episode_guid.value;
  danmuTitleData.value.html = `弹幕加载中...`
  art.layers.update(danmuTitleData.value)
  let episode_number = playInfo.value.episode_number === undefined ? 1 : playInfo.value.episode_number;
  let danmuku = `/danmu/get?${getDanmuparams()}`;
  return fetch(danmuku, {signal: danmakuRequestController.signal, headers: {Authorization: VueCookies.get('authorization') || ''}})
      .then(async res => {
        const json = await res.json();
        if (!res.ok || (json?.code !== undefined && json.code !== 0)) throw new Error(json?.msg || `弹幕服务返回 HTTP ${res.status}`);
        if (generation === danmakuLoadGeneration) activeDanmakuSource.value = res.headers.get('X-Danmaku-Source') || '';
        return json;
      })
      .then(async json => {
        if (player !== art || generation !== danmakuLoadGeneration || episodeGuid !== episode_guid.value) return;
        const rows = episodeDanmaku(json, episode_number);
        await applyDanmakuRows(rows, episode_number);
        if (player === art && generation === danmakuLoadGeneration) void GetEmoji(activeDanmakuSource.value);
      }).catch(err => {
    if (player !== art || generation !== danmakuLoadGeneration || episodeGuid !== episode_guid.value) return;
    if (err.name === 'AbortError') return;
    danmuTitleData.value.html = '弹幕加载失败，可搜索其他来源或恢复自动匹配';
    danmakuSearchError.value = errorText(err);
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
    const selected = choosePreferredQuality(res, preferredQuality.value, selector[0].selector[0]);
    if (!selected) throw new Error('当前影片没有可用画质');
    currentQuality.value = {...selected, html: `${selected.resolution} (${(Number(selected.bitrate) / 1000000).toFixed(1)}Mbps)`};
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
  let remote = primaryMediaFile(StreamList.value);
  if (!regex.test(remote?.path || '')) return;
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

async function GetPalyUrl(startTimestamp = playInfo.value.watched_ts, operation = null, audioOverride = currentAudio.value, qualityOverride = null) {
  if (art !== null && art !== undefined) {
    art.loading.show = true;
  }
  let api = "/api/v1/play/play"
  const audio = audioOverride;
  const quality = qualityOverride || currentQuality.value;
  const _channels = audio?.channels || 2;
  const local = primaryMediaFile(StreamList.value);
  let _data = {
    "media_guid": local.guid,
    "video_guid": StreamList.value.video_streams[0].guid,
    "video_encoder": StreamList.value.video_streams[0].codec_name,
    "resolution": quality?.resolution ?? QualityData.value[0].resolution,
    "bitrate": quality?.bitrate ?? StreamList.value.video_streams[0].bps,
    "startTimestamp": Math.max(0, Math.floor(Number(startTimestamp) || 0)),
    "audio_encoder": "aac",
    "audio_guid": audio?.guid || '',
    "subtitle_guid": streamSubtitleGuid(currentSubtitle.value),
    "channels": await GetChannels(_channels)
  };
  let res = await COMMON.requests("POST", api, true, _data, {signal: operation?.signal})
  if (operation && !operation.isCurrent() && res?.play_link && res.play_link !== urlBase.value) {
    void mediaP('media.quit', res.play_link).catch(() => {});
  }
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
  if (art && !recoveryState.value && sourceEpisode === episode_guid.value && sourceEpisode === playInfo.value?.guid
      && art.currentTime >= 5 && StreamList.value?.video_streams?.length && QualityData.value?.length) {
    return {
      "item_guid": playInfo.value?.guid || episode_guid.value,
      "media_guid": StreamList.value.video_streams[0].media_guid,
      "video_guid": StreamList.value.video_streams[0].guid,
      "audio_guid": currentAudio.value?.guid || '',
      "subtitle_guid": currentSubtitle.value?.guid || "",
      "resolution": currentQuality.value?.resolution ?? QualityData.value[0].resolution,
      "bitrate": currentQuality.value?.bitrate ?? QualityData.value[0].bitrate,
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
  const audioPreferences = preferenceHandle;
  const audioPreferenceVersion = preferenceResetGeneration;
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
    operation.assertCurrent();
    if (paused) art.pause();
    if (selected.language && audioPreferences.isCurrent() && audioPreferenceVersion === preferenceResetGeneration) {
      preferredAudioLanguage.value = selected.language;
      savePlayerPreference('audioLanguage', selected.language, audioPreferences);
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

async function GetEmoji(sourceId = '') {
  const episode = episode_guid.value;
  const generation = danmakuLoadGeneration;
  try {
    let api = "/danmu/getEmoji?" + getDanmuparams() + '&source_id=' + encodeURIComponent(sourceId)
    let res = await fetch(api, {signal: danmakuRequestController.signal, headers: {Authorization: VueCookies.get('authorization') || ''}})
    let res_json = await res.json()
    if (episode === episode_guid.value && generation === danmakuLoadGeneration) emojos.value = res_json;
  } catch {
    if (episode === episode_guid.value && generation === danmakuLoadGeneration) emojos.value = [];
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
  localSubtitleText = ''; localSubtitleName.value = '';
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

async function addEpisodeNavigation(player, controls) {
  for (const [direction, name, index, findEpisode] of [[-1, '上一集', 10, previousEpisode], [1, '下一集', 11, nextEpisode]]) {
    const enabled = Boolean(findEpisode(EpisodeList.value, playInfo.value, gallery_type.value));
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = !enabled;
    button.setAttribute('aria-label', name);
    button.style.cssText = 'display:flex;align-items:center;justify-content:center;border:0;padding:0;background:transparent;color:inherit;cursor:inherit';
    button.innerHTML = `<img width="22" height="22" alt="" src="./images/next.svg" style="transform:rotate(${direction === -1 ? 180 : 0}deg)">`;
    const activate = () => enabled ? playAdjacent(direction) : undefined;
    controls.push({name, position: 'left', index, html: button, tooltip: name,
      style: {opacity: enabled ? '1' : '0.35', pointerEvents: enabled ? '' : 'none'}, click: activate});
    await addArtConfig(player, 'setting', {name: name + '设置', html: name, tooltip: enabled ? '' : '没有' + name,
      onClick: async () => { if (!enabled) return '没有' + name; player.setting.show = false; await activate(); return ''; },
      mounted: element => { element.setAttribute('aria-disabled', String(!enabled)); element.style.opacity = enabled ? '1' : '0.35'; }});
  }
}

async function UpdateControl(_art) {
  const controlPreferences = preferenceHandle;
  const controlVersion = preferenceResetGeneration;
  const controlsCurrent = () => controlPreferences.isCurrent() && controlVersion === preferenceResetGeneration;
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
      if (!controlsCurrent()) return `${_art.playbackRate}×`;
      _art.playbackRate = item.rate;
      savePlayerPreference('playbackRate', item.rate, controlPreferences);
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
    await addEpisodeNavigation(_art, forData);

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
    onChange: item => controlsCurrent() ? setSubtitleFontSize(item.range[0], {handle: controlPreferences}) : `${subtitleFontSize.value}px`,
    onRange: item => controlsCurrent() ? setSubtitleFontSize(item.range[0], {handle: controlPreferences}) : `${subtitleFontSize.value}px`
  });
  await addArtConfig(_art, 'setting', {name: '媒体文件', html: '版本／文件', tooltip: selectedMediaLabel.value,
    onClick: () => { if (controlsCurrent()) void openMediaFiles(); return selectedMediaLabel.value; }});
  await addArtConfig(_art, 'setting', {name: '字幕偏移', html: '字幕时间偏移', tooltip: `${subtitleOffset.value} 秒（正值延后）`,
    range: [subtitleOffset.value, -60, 60, 0.5], onChange: item => { if (controlsCurrent()) void setSubtitleOffset(item.range[0]).catch(showSubtitleError); return `${subtitleOffset.value} 秒`; }});
  await addArtConfig(_art, 'setting', {name: '字幕位置', html: '普通字幕距底部', range: [subtitleBottom.value, 0, 40, 1],
    onChange: item => { if (controlsCurrent()) { subtitleBottom.value = item.range[0]; applySubtitleAppearance(); } return `${subtitleBottom.value}%`; }});
  await addArtConfig(_art, 'setting', {name: '字幕描边', html: '普通字幕阴影', range: [subtitleOutline.value, 0, 5, 1],
    onChange: item => { if (controlsCurrent()) { subtitleOutline.value = item.range[0]; applySubtitleAppearance(); } return `${subtitleOutline.value}px`; }});
  await addArtConfig(_art, 'setting', {name: '播放诊断', html: '播放诊断', onClick: () => { if (controlsCurrent()) openDiagnostics(); return ''; }});
  const audioTracks = StreamList.value?.audio_streams || [];
  await addArtConfig(_art, 'setting', {
    name: '音轨选择', html: '音轨', tooltip: audioLabel(currentAudio.value),
    selector: audioTracks.length ? audioTracks.map(track => ({guid: track.guid,
      html: audioLabel(track), default: track.guid === currentAudio.value?.guid})) : [{html: '当前影片无音轨'}],
    onSelect: item => controlsCurrent() ? switchAudio(item) : audioLabel(currentAudio.value)
  });
  await addArtConfig(_art, 'setting', {
    name: '自动连播', html: '自动连播', switch: autoPlayNext.value,
    onSwitch: item => {
      if (!controlsCurrent()) return item.switch;
      autoPlayNext.value = !item.switch;
      savePlayerPreference('autoPlayNext', autoPlayNext.value, controlPreferences);
      if (!autoPlayNext.value) autoplayCountdown.cancel();
      return autoPlayNext.value;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '触摸手势', html: '触摸手势', tooltip: '全屏触摸时生效', switch: gesturesEnabled.value,
    onSwitch: item => {
      if (!controlsCurrent()) return item.switch;
      gesturesEnabled.value = !item.switch;
      savePlayerPreference('gesturesEnabled', gesturesEnabled.value, controlPreferences);
      disposeMobileGestures.refresh?.();
      return gesturesEnabled.value;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '长按加速倍率', html: '长按加速倍率', tooltip: `${gestureHoldRate.value}×`,
    selector: GESTURE_HOLD_RATES.map(rate => ({rate, html: `${rate}×`, default: rate === gestureHoldRate.value})),
    onSelect: item => {
      if (!controlsCurrent() || !GESTURE_HOLD_RATES.includes(item.rate)) return `${gestureHoldRate.value}×`;
      gestureHoldRate.value = item.rate;
      savePlayerPreference('gestureHoldRate', item.rate, controlPreferences);
      disposeMobileGestures.refresh?.();
      return `${item.rate}×`;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '首选字幕语言', html: '首选字幕语言', tooltip: `${subtitleLanguageLabel(preferredSubtitleLanguage.value)} · 下次开播`,
    selector: subtitleLanguageChoices(StreamList.value?.subtitle_streams, preferredSubtitleLanguage.value)
      .map(item => ({value: item.value, html: item.label, default: item.value === preferredSubtitleLanguage.value})),
    onSelect: item => {
      if (!controlsCurrent() || !subtitleLanguageChoices(StreamList.value?.subtitle_streams, preferredSubtitleLanguage.value).some(row => row.value === item.value)) return subtitleLanguageLabel(preferredSubtitleLanguage.value);
      preferredSubtitleLanguage.value = item.value;
      savePlayerPreference('subtitleLanguage', item.value, controlPreferences);
      return `${subtitleLanguageLabel(item.value)} · 下次开播`;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '默认画质', html: '默认画质', tooltip: `${QUALITY_PREFERENCES.find(item => item.value === preferredQuality.value)?.label || '最高可用'} · 下次开播`,
    selector: QUALITY_PREFERENCES.map(item => ({value: item.value, html: item.label, default: item.value === preferredQuality.value})),
    onSelect: item => {
      const selected = QUALITY_PREFERENCES.find(row => row.value === item.value);
      if (!controlsCurrent() || !selected) return '';
      preferredQuality.value = selected.value;
      savePlayerPreference('qualityPreference', selected.value, controlPreferences);
      return `${selected.label} · 下次开播`;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '首选外部播放器', html: '首选外部播放器', tooltip: preferredExternalLabel.value,
    selector: externalChoices.map(item => ({value: item.value, html: item.label, default: item.value === effectiveExternalPlayer.value})),
    onSelect: item => {
      const selected = externalChoices.find(row => row.value === item.value);
      if (!controlsCurrent() || !selected) return '';
      preferredExternalPlayer.value = selected.value;
      savePlayerPreference('externalPlayer', selected.value, controlPreferences);
      return selected.label;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: '恢复播放偏好', html: '恢复本账号播放偏好', tooltip: '仅当前账号与浏览器',
    onClick: () => requestPlayerPreferenceReset(controlPreferences, controlVersion)
  });
  await addArtConfig(_art, 'setting', {
    name: '播完本集停止', html: '播完本集停止', switch: stopAfterCurrent.value,
    onSwitch: item => {
      if (!controlsCurrent()) return item.switch;
      stopAfterCurrent.value = !item.switch;
      if (stopAfterCurrent.value) autoplayCountdown.cancel();
      return stopAfterCurrent.value;
    }
  });
  await addArtConfig(_art, 'setting', {
    name: 'ASS特效字幕', html: 'ASS 特效字幕', tooltip: useAssSubtitles.value ? '原始样式' : '普通字幕',
    switch: useAssSubtitles.value,
    onSwitch: item => {
      if (!controlsCurrent()) return item.switch;
      useAssSubtitles.value = !item.switch;
      savePlayerPreference('assSubtitles', useAssSubtitles.value, controlPreferences);
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
  await addArtConfig(_art, 'setting', {name: '弹幕来源', html: '弹幕来源与偏好', tooltip: activeDanmakuSourceName.value,
    onClick: () => { if (controlsCurrent()) openDanmakuSources(); return activeDanmakuSourceName.value; }});

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
      if (!controlsCurrent()) return item.switch;
      use_302_play.value = !item.switch;
      savePlayerPreference('use302', use_302_play.value, controlPreferences);
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

async function play(options = null) {
  loadPlayerPreferences();
  autoplayCountdown.cancel();
  stopAfterCurrent.value = false;
  const operation = playbackSession.begin();
  if (!options) { recoveryRun++; clearPlaybackRecovery(); recoveryBusy.value = false; }
  else clearTimeout(sourceTimer);
  sourcePaused = options?.paused ?? art?.video?.paused ?? false;
  sourceEpisode = null;
  sourcePosition = null;
  if (art) { art.pause(); art.loading.show = true; }
  const playLink = urlBase.value;
  try {
    subtitleSwitchGeneration++;
    cancelDanmakuRequests();
    danmakuLoadGeneration++;
    activeDanmakuSource.value = '';
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
    let initialInfo = null;
    if (!episode_guid.value) {
      initialInfo = await GetPayInfo(guid.value, operation);
      episode_guid.value = initialInfo.item.guid;
    }
    const metadata = await loadPlaybackMetadata(COMMON.requests, episode_guid.value, {signal: operation.signal, initialInfo,
      mediaGuid: options?.mediaGuid || (options?.episode === episode_guid.value ? StreamList.value?.selected_media_guid : null)});
    operation.assertCurrent();
    if (playInfo.value?.guid !== metadata.info.item.guid || StreamList.value?.selected_media_guid !== metadata.streams.selected_media_guid) {
      subtitleOffset.value = 0; subtitleBottom.value = 10; subtitleOutline.value = 2;
      assRenderer.setOffset(0); pgsRenderer.setOffset(0);
    }
    localSubtitleText = ''; localSubtitleName.value = '';
    playInfo.value = metadata.info.item;
    StreamList.value = metadata.streams;
    allMediaStreams.value = metadata.allStreams;
    currentAudio.value = chooseAudio(metadata.streams.audio_streams, options?.audioGuid ?? playInfo.value.audio_guid, preferredAudioLanguage.value);
    setQualityOptions(metadata.qualities);
    if (!options?.quality && qualityPreferenceFallback(currentQuality.value, preferredQuality.value)) {
      COMMON.ShowMsg(`默认画质当前不可用，已使用 ${currentQuality.value.resolution}`);
    }
    if (options?.quality) {
      const requested = metadata.qualities.find(item => item.resolution === options.quality.resolution && Number(item.bitrate) === Number(options.quality.bitrate));
      if (!requested) throw new Error('原画质已不可用');
      currentQuality.value = {...requested, html: `${requested.resolution} (${(requested.bitrate / 1000000).toFixed(1)}Mbps)`};
    }
    if (options?.position != null) playInfo.value.watched_ts = options.position;

    subtitleLoader.clear();
    currentSubtitle.value = null;
    // Recovery/explicit per-title selections override persistent language preferences.
    currentSubtitle.value = choosePreferredSubtitle(StreamList.value?.subtitle_streams,
      playInfo.value.subtitle_guid, preferredSubtitleLanguage.value, options?.subtitleGuid);

    await GetPalyUrl(undefined, operation, currentAudio.value, options?.quality || null);
    operation.assertCurrent();
    if (art !== null && !options?.external) {
      watchPlaybackSource(art, url.value);
      await switchRecoverableSource(art, url.value, {signal: operation.signal, position: playInfo.value.watched_ts, paused: sourcePaused});
      operation.assertCurrent();
    }
    if (!options?.external) {
      clearPlaybackRecovery();
      if (art) await UpdateControl(art);
    }
    if (playLink && playLink !== urlBase.value) {
      void mediaP("media.quit", playLink).catch(() => {});
    }
  } catch (error) {
    if (operation.isCurrent() && !isPlaybackAbort(error)) {
      if (urlBase.value && urlBase.value !== playLink) void mediaP('media.quit', urlBase.value).catch(() => {});
      reportPlaybackFailure(error, options);
    }
    throw error;
  } finally {
    if (operation.isCurrent() && art) art.loading.show = false;
  }
}

let episodeSwitchBusy = false;
async function playAdjacent(direction) {
  if (episodeSwitchBusy) return;
  const episode = (direction === -1 ? previousEpisode : nextEpisode)(EpisodeList.value, playInfo.value, gallery_type.value);
  if (!episode) return;
  const previous = episode_guid.value;
  episodeSwitchBusy = true;
  try {
    void SendPlayRecord();
    episode_guid.value = episode.guid;
    await play();
  } catch (error) {
    if (error.name !== 'AbortError' && error.name !== 'CanceledError') {
      if (episode_guid.value === episode.guid && !recoveryState.value) episode_guid.value = previous;
      COMMON.ShowMsg(`切换${direction === -1 ? '上一集' : '下一集'}失败：` + errorText(error));
    }
  } finally {
    episodeSwitchBusy = false;
  }
}
function play_next() { return playAdjacent(1); }
function play_previous() { return playAdjacent(-1); }

async function switchSubtitleUrl({plain = false} = {}) {
  if (!currentSubtitle.value || !urlBase.value) return;
  if (currentSubtitle.value.local && localSubtitleText) {
    subtitleLoader.clear(); await subtitleLoader.render(localSubtitleText); return;
  }
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
  if (!art || !preferenceHandle.isCurrent() || !playInfo.value) return;
  const player = art, episode = episode_guid.value;
  mountPlayerHeading(art);
  if (timerSendPlayRecord.value !== null) {
    clearInterval(timerSendPlayRecord.value)
  }
  if (!art.fnosTemporarySpeed) art.playbackRate = preferenceHandle.read('playbackRate');
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
  void loadDanmakuSourceConfig();
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
  const player = data;
  const current = () => player === art && player.fnosSourceGeneration === playbackSession.generation;
  bufferedRecovery?.dispose();
  const guard = bufferedRecovery = bufferedPlaybackFailure(player, reportPlaybackFailure, {
    isCurrent: current, resume: () => currentMediaEngine(player)?.startLoad?.(player.currentTime),
  });
  player.on('destroy', () => guard.dispose());
  const fail = error => { if (current()) guard.notify(error); };
  player.on('fnos:media-error', fail);
  player.on('video:error', () => { if (player.video.error) fail(player.video.error); });
  player.on('video:canplay', () => { if (current()) clearTimeout(sourceTimer); });
  player.on('video:timeupdate', () => {
    if (current() && !recoveryState.value && Number.isFinite(player.currentTime)) sourcePosition = player.currentTime;
  });
  player.on('video:play', () => { if (current() && !recoveryState.value) sourcePaused = false; });
  player.on('video:pause', () => { if (current() && !recoveryState.value) sourcePaused = true; });
  setSubtitleFontSize(subtitleFontSize.value, {persist: false});
  bindSubtitleTrack(art);
  art.on('subtitleLoad', () => {
    if (currentSubtitle.value) art.subtitle.update();
  });
  art.on('restart', () => {
    if (player === art) void ready();
  });
  art.on('ready', () => { if (player === art) void ready(); });
  art.on('video:ratechange', () => {
    if (player !== art) return;
    if (!art.fnosTemporarySpeed) {
      const speedSetting = art.setting.find('倍速设置');
      if (speedSetting) speedSetting.tooltip = `${art.playbackRate}×`;
    }
  });
  let lastSkipIndex = -1;
  lastDanmuLoadedUntil = -1;
  art.on("video:timeupdate", () => {
    if (player !== art) return;
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
    if (currentSubtitle.value && !subtitlePlaybackError.value) void subtitleLoader.update(Math.max(0, art.currentTime - subtitleOffset.value)).catch(showSubtitleError);
  });
  art.on('video:seeked', () => {
    if (currentSubtitle.value && !subtitlePlaybackError.value) void subtitleLoader.update(Math.max(0, art.currentTime - subtitleOffset.value)).catch(showSubtitleError);
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
    if (player === art) await UpdateControl(player);
  });

  art.on('fullscreenWeb', async () => { if (player === art) await UpdateControl(player); });

  art.on('control', (state) => {
    if (player !== art) return;
    // 控制栏事件可在按下和松开之间触发；保留按钮节点，避免丢失 click。
    if (playerHeading?.parentElement) playerHeading.parentElement.style.display = state ? '' : 'none';
    danmuTitleData.value.disable = !state
    art.layers.update(danmuTitleData.value)
  });

  art.on('artplayerPluginDanmuku:config', (option) => {
    if (player !== art) return;
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
  const gestureOwner = preferenceHandle;
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
  if (!gestureOwner.isCurrent() || art !== _art) return;
  disposeMobileDanmaku = installMobileDanmaku(_art);
  disposeMobileGestures = installMobileGestures(_art, window, document, {getPreferences: () => ({
    enabled: gestureOwner.isCurrent() && gesturesEnabled.value, holdRate: gestureHoldRate.value,
  })});
  disposeDesktopIdle = installDesktopIdle(_art);
  art = _art;
  recoveryTarget.value = _art.template.$player;
  art.id = episode_guid.value
  watchPlaybackSource(art, url.value);
  art.url = url.value
}

let initializationGeneration = 0;
const onMountedFun = async () => {
  if (!preferenceHandle.isCurrent()) return;
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
      reportPlaybackFailure(error);
    }
  } finally {
    if (generation === initializationGeneration) loading.value = false;
  }
};
const playbackError = ref('');
let playerMounted = false;
watch(() => accountState.revision, () => {
  // Never reuse a handle after an account transition, even A -> B -> A.
  preferenceHandle = playerPreferences.bindAccount(accountState.account);
  preferenceWarningShown = false;
  preferenceResetGeneration++;
  showPreferenceReset.value = false;
  showMediaFiles.value = false;
  showDiagnostics.value = false;
  showDanmakuSources.value = false;
  danmakuSourceConfig.value = null;
  cancelDanmakuRequests();
  diagnosticText.value = '';
  allMediaStreams.value = null;
  localSubtitleText = ''; localSubtitleName.value = '';
  preferenceResetOwner = null;
  showModal.value = false;
  externalMediaUrl.value = '';
  disposeMobileGestures();
  loadPlayerPreferences();
  if (!playerMounted) return;
  initializationGeneration++;
  playbackSession.cancel();
  recoveryRun++;
  autoplayCountdown.cancel();
  releaseExternalSession();
  clearPlaybackRecovery();
  bufferedRecovery?.dispose();
  if (timerSendPlayRecord.value !== null) clearInterval(timerSendPlayRecord.value);
  timerSendPlayRecord.value = null;
  art?.pause();
  if (art) releaseMediaEngine(art);
  art = null;
  recoveryTarget.value = null;
  playInfo.value = null;
  StreamList.value = null;
  currentAudio.value = null;
  currentSubtitle.value = null;
  EpisodeList.value = null;
  urlBase.value = '';
  url.value = '';
  loading.value = true;
  playbackError.value = '';
  if (preferenceHandle.isCurrent()) void onMountedFun();
}, {flush: 'sync'});

onBeforeRouteUpdate(async (to, from) => {
  releaseExternalSession();
  externalBusy.value = false;
  void SendPlayRecord();
  playbackSession.cancel();
  recoveryRun++;
  clearPlaybackRecovery();
  autoplayCountdown.cancel();
  selectPlayback(to.query);
  await onMountedFun();
});

onBeforeRouteLeave(async (to, from) => {
  // Browser/system back in web fullscreen exits fullscreen before leaving playback.
  if (exitPlayerFullscreen(art)) return false;
  releaseExternalSession();
  void SendPlayRecord();
  playbackSession.cancel();
  initializationGeneration++;
  recoveryRun++;
  clearPlaybackRecovery();
  if (urlBase.value) void mediaP('media.quit', urlBase.value).catch(() => {});
  autoplayCountdown.cancel();
  if (timerSendPlayRecord.value) {
    clearInterval(timerSendPlayRecord.value)
    timerSendPlayRecord.value = null
  }
});

onBeforeUnmount(async () => {
  playerMounted = false;
  playerPreferences.clearAccount();
  cancelDanmakuRequests();
  releaseExternalSession();
  initializationGeneration++;
  recoveryRun++;
  autoplayCountdown.cancel();
  void SendPlayRecord();
  playbackSession.cancel();
  clearTimeout(sourceTimer);
  bufferedRecovery?.dispose();
  recoveryTarget.value = null;
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
  playerMounted = true;
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
    <PlaybackRecoveryCard v-if="playbackError" :message="playbackError" :busy="recoveryBusy" :lower-label="lowerRecoveryLabel" :can-external="canRecoverExternally"
      @retry="recoverPlayback()" @lower="recoverPlayback('lower')" @external="recoverPlayback('external')" @back="backFromPlayer" />
    <div v-else class="load" role="status" aria-label="正在加载影片"></div>
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

  <Teleport v-if="recoveryTarget && recoveryState && !playbackError" :to="recoveryTarget">
    <PlaybackRecoveryCard :message="recoveryState.message" :busy="recoveryBusy" :lower-label="lowerRecoveryLabel" :can-external="canRecoverExternally"
      @retry="recoverPlayback()" @lower="recoverPlayback('lower')" @external="recoverPlayback('external')" @back="backFromPlayer" />
  </Teleport>

  <n-modal v-model:show="showPreferenceReset" :to="preferenceResetTarget || undefined" preset="dialog" title="恢复本账号播放偏好"
    positive-text="恢复默认" negative-text="取消" :mask-closable="!preferenceResetBusy"
    :positive-button-props="{loading: preferenceResetBusy}" :negative-button-props="{disabled: preferenceResetBusy}"
    style="width: min(440px, calc(100vw - 32px))" @positive-click="confirmPlayerPreferenceReset">
    <p>仅重置当前账号在此浏览器保存的音轨／字幕语言、默认画质、首选外部播放器、自动连播、ASS 样式、字号、倍速、302、触摸手势和长按倍率。</p>
    <p>倍速、字号、连播和手势立即恢复；音轨、字幕、默认画质和 302 在重新打开影片或切集时生效。当前播放不重开，观看进度、搜索历史和其他账号设置不变。</p>
  </n-modal>
  <n-modal v-model:show="showDanmakuSearch" title="搜索与选择弹幕" preset="card"
           :style="{width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto'}">
    <n-space vertical :size="16">
      <n-text>当前集：{{ playInfo?.title }}<span v-if="playInfo?.episode_number"> · 第 {{ playInfo.episode_number }} 集</span></n-text>
      <n-input v-model:value="danmakuKeyword" placeholder="输入片名、别名，或粘贴具体集数的平台播放链接" :disabled="danmakuBusy" @keyup.enter="searchDanmaku" />
      <n-space :wrap="false">
        <n-select v-model:value="danmakuSearchSource" :options="danmakuSearchChoices"
                  :disabled="danmakuBusy" style="width: 150px" />
        <n-button type="primary" @click="searchDanmaku" :loading="danmakuBusy" :disabled="!danmakuKeyword.trim()">查询弹幕来源</n-button>
      </n-space>
      <n-space align="center"><n-text>当前弹幕来源：{{ activeDanmakuSourceName }}</n-text><n-button @click="openDanmakuSources">来源管理／个人偏好</n-button></n-space>
      <n-text depth="3">先选择平台与集数，再选择仅当前集或当前季度。季度绑定只使用明确分集编号，不猜测缺集；已有单集覆盖优先，失败时手动换源。配置只保存到当前账号，旧共享链接仍兼容读取。</n-text>
      <n-alert v-if="danmakuSearchError" type="error" :show-icon="false">{{ danmakuSearchError }}</n-alert>
      <n-empty v-if="danmakuSearchDone && !danmakuResults.length" description="未找到来源，请尝试别名、切换搜索来源或粘贴播放链接" />
      <div v-if="danmakuEpisodes.length" style="padding: 12px; border: 1px solid #8885; border-radius: 6px">
        <div style="margin-bottom: 8px">{{ danmakuSelectedSource?.title }} · {{ danmakuSelectedSource?.platform }}</div>
        <n-select v-model:value="danmakuSelectedEpisode" :options="danmakuEpisodeOptions" :disabled="danmakuBusy" />
        <n-select v-model:value="danmakuApplyScope" style="margin-top:12px" :disabled="danmakuBusy" :options="[{label:'仅当前集',value:'episode'},{label:'当前季度（按来源分集编号）',value:'season'}]" />
        <n-button style="margin-top: 12px" type="primary" @click="useDanmakuEpisode" :loading="danmakuBusy">保存个人来源并加载</n-button>
      </div>
      <div v-for="(result, index) in danmakuResults" :key="result.url + index" style="padding: 12px; border: 1px solid #8885; border-radius: 6px">
        <n-space justify="space-between" align="center">
          <div>{{ result.title }}<span v-if="result.season"> · 第 {{ result.season }} 季</span> · {{ result.platform }}</div>
          <n-button @click="chooseDanmakuSource(result)" :disabled="danmakuBusy">选择集数</n-button>
        </n-space>
      </div>
    </n-space>
  </n-modal>

  <DanmakuSourcesDialog v-if="showDanmakuSources" :key="`${accountState.revision}:${episode_guid}`" :request="danmakuRequest"
    :episode-guid="episode_guid" :parent-guid="guid" @close="showDanmakuSources = false" @saved="reloadDanmakuSources" />

  <n-modal v-model:show="showSubtitleSearch" title="搜索与选择字幕" preset="card"
           :style="{width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto'}">
    <n-space vertical :size="16">
      <n-text depth="3">ASS / SSA 默认保留字体、定位和动画。若设备渲染异常，可在播放器设置中关闭“ASS 特效字幕”；普通字幕大小滑块不覆盖 ASS 原始样式。</n-text>
      <n-text depth="3">时间偏移支持普通文本、ASS 和 PGS，正值延后；位置、字号、阴影仅影响普通文本。本集调整不保存为全局偏好。</n-text>
      <label>导入本地字幕（UTF-8 SRT／VTT，最大 2 MB）<input type="file" accept=".srt,.vtt" aria-label="导入本地字幕" @change="importLocalSubtitle" /></label>
      <n-text v-if="localSubtitleName">当前本地字幕：{{ localSubtitleName }}；不上传服务器，切集或重新开播后清除。</n-text>
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

  <n-modal v-model:show="showMediaFiles" title="选择版本／媒体文件" preset="card"
    :mask-closable="!mediaFileBusy" :closable="!mediaFileBusy"
    :style="{width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto'}">
    <n-space vertical :size="16">
      <n-text>当前文件：{{ selectedMediaLabel }}</n-text>
      <n-select v-model:value="selectedMediaGuid" :options="mediaFileOptions" :disabled="mediaFileBusy" />
      <n-alert type="info" :show-icon="false">不同剪辑版可能时间线不同，默认从头播放；选择继续当前位置时请自行确认时间线。轨道和画质按所选文件重新读取。</n-alert>
      <n-checkbox v-model:checked="mediaFileResume" :disabled="mediaFileBusy">继续当前播放位置</n-checkbox>
      <n-button type="primary" :loading="mediaFileBusy" @click="applyMediaFile">应用文件</n-button>
    </n-space>
  </n-modal>
  <n-modal v-model:show="showDiagnostics" title="播放诊断" preset="card"
    :style="{width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto'}">
    <n-space vertical :size="16">
      <n-text depth="3">显示浏览器当前缓冲、编码、请求画质和错误代码。服务端未提供确切转码状态时标为 unknown；不从编码或链接猜测。导出不含影片路径、账号、会话、地址或凭据。</n-text>
      <n-input type="textarea" :value="diagnosticText" readonly :autosize="{minRows: 12, maxRows: 24}" :input-props="{'aria-label': '脱敏播放诊断'}" />
      <n-space><n-button @click="refreshDiagnostics">刷新</n-button><n-button @click="copyDiagnostics">复制脱敏诊断</n-button></n-space>
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
      <p>外部播放期间请保留本播放页。链接失效时请重新获取；PotPlayer 图标会下载播放列表，可用 PotPlayer 打开该文件。</p>
      <p v-if="preferExternalFile">Windows 使用原文件地址，由外部播放器选择音轨、字幕和播放位置。</p>
      <p v-if="externalBusy" role="status">正在准备外部播放链接…</p>
      <div v-else-if="externalError" role="alert">
        <p>{{ externalError }}</p><n-button @click="openExternalPlayback">重新获取链接</n-button>
      </div>
      <div v-else-if="externalMediaUrl">
        <p>PotPlayer：下载下方播放列表后用播放器打开，或复制 HTTP 地址，在 PotPlayer 按 Ctrl+U 粘贴播放。</p>
        <n-input :value="externalMediaUrl" readonly :input-props="{'aria-label': '外部播放器 HTTP 媒体地址'}" @focus="event => event.target.select?.()" />
        <p v-if="preferredExternalPlayer && !effectiveExternalPlayer">上次首选不适用于当前平台，请从下方选择播放器。</p>
        <p v-if="preferredExternalHref"><a class="external-preferred-action" :href="preferredExternalHref"
          :download="effectiveExternalPlayer === 'potplayer' ? 'fnos-tv-playlist.m3u' : undefined">{{ effectiveExternalPlayer === 'potplayer' ? '下载首选 PotPlayer 播放列表' : `使用首选 ${preferredExternalLabel} 打开` }}</a></p>
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
.external-preferred-action {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 6px;
  background: var(--cinema-accent, #c79b65);
  color: #141820;
  text-decoration: none;
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

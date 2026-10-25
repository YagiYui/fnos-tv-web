<script setup>
import {computed, getCurrentInstance, onMounted, onBeforeUnmount, ref, inject, nextTick, watch} from 'vue';
import {onBeforeRouteUpdate, onBeforeRouteLeave} from 'vue-router';
import {useBrowseSnapshots} from '../../store.js';
import MediaImage from '../../components/MediaImage.vue';
import PageBack from '../../components/PageBack.vue';
import WatchlistButton from '../../components/WatchlistButton.vue';
import {mediaDetailTitle} from '../Play/player-presentation.js';
import {mediaFlag, seasonTargets} from '../../media-actions.js';

const proxy = getCurrentInstance().appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
const browseSnapshots = useBrowseSnapshots();
const mediaActions = inject('mediaActions', null);
const mediaChanges = inject('mediaChanges', ref(0));
let detailMediaRevision = mediaChanges.value;
let actionGeneration = 0;
const actionBusy = ref('');
const actionNote = ref('');
const actionError = ref('');
const batchConfirm = ref(null);
const batchProgress = ref(null);
const batchResult = ref(null);
const episodesReady = ref(false);
const detailsReady = ref(false);
const favoriteState = computed(() => mediaFlag(VideoDataInfo.value, 'favorite'));
const watchedState = computed(() => mediaFlag(VideoDataInfo.value, 'watched'));
const pageScroll = inject('pageScroll', {getTop: () => window.scrollY, scrollTo: top => window.scrollTo(0, top)});
const guid = ref(proxy.$route.query.guid);
const gallery_type = ref(proxy.$route.query.gallery_type);
const VideoDataInfo = ref({});
const SeasonData = ref(null);
const PersonList = ref(null);
const EpisodeList = ref(null);
const batchItems = computed(() => {
  const items = new Map((EpisodeList.value || []).map(item => [item.guid, item]));
  return (batchConfirm.value?.ids || []).map(id => items.get(id) || {guid: id, title: '分集信息已变化'});
});
const playInfo = ref(null);
const play_guid = ref(null);
const backImg = ref(null);
const expandedOverview = ref(false);
const loadError = ref('');
const detailType = computed(() => ({Movie: '电影', TV: '剧集', season: '季'})[gallery_type.value] || '影片');
const detailTitle = computed(() => mediaDetailTitle(VideoDataInfo.value, gallery_type.value));
let controller = null, generation = 0;
let viewAccount = COMMON.userKey, viewRevision = browseSnapshots.revision;
const snapshotKey = () => JSON.stringify(['detail', guid.value, gallery_type.value]);
function updateBackdrop() {
  const image = VideoDataInfo.value.backdrops || VideoDataInfo.value.posters;
  backImg.value = image ? COMMON.imgUrl + '/92/17/' + image + '?w=200' : null;
}
function restoreDetail() {
  const saved = browseSnapshots.get(viewAccount, snapshotKey());
  VideoDataInfo.value = saved?.info || {};
  SeasonData.value = saved?.seasons || null;
  PersonList.value = saved?.people || null;
  EpisodeList.value = saved?.episodes || null;
  expandedOverview.value = saved?.expanded || false;
  playInfo.value = null; play_guid.value = null;
  episodesReady.value = false;
  detailsReady.value = false;
  updateBackdrop();
  return saved?.scrollY || 0;
}
function saveDetail() {
  if (!VideoDataInfo.value.guid || detailMediaRevision !== mediaChanges.value) return;
  browseSnapshots.save(viewAccount, snapshotKey(), {info: VideoDataInfo.value, seasons: SeasonData.value,
    people: PersonList.value, episodes: EpisodeList.value, expanded: expandedOverview.value,
    scrollY: pageScroll.getTop()}, viewRevision);
}
function cancelDetail() { generation++; controller?.abort(); controller = null; }
const initialScroll = restoreDetail();
async function loadDetail(scrollTop = null) {
  cancelDetail();
  const requestGeneration = generation;
  const requestController = controller = new AbortController();
  const id = guid.value, type = gallery_type.value;
  detailsReady.value = false;
  if (type === 'season') episodesReady.value = false;
  const current = () => generation === requestGeneration && !requestController.signal.aborted && viewAccount === COMMON.userKey && viewRevision === browseSnapshots.revision;
  const request = (method, path, data = {}) => COMMON.requests(method, path, true, data, {signal: requestController.signal});
  loadError.value = '';
  if (scrollTop !== null) {
    await nextTick();
    if (!current()) return;
    pageScroll.scrollTo(scrollTop);
  }
  try {
    if (typeof id !== 'string' || !id) throw new Error('请选择有效的影片');
    const info = await request('GET', '/api/v1/item/' + id);
    if (!current()) return;
    if (!info || info.guid !== id) throw new Error('影片详情数据无效');
    VideoDataInfo.value = info; detailsReady.value = true; detailMediaRevision = mediaChanges.value; updateBackdrop(); saveDetail();
    const apply = async (method, path, data, update) => {
      const result = await request(method, path, data);
      if (current()) { update(result); saveDetail(); }
    };
    const jobs = [apply('POST', '/api/v1/play/info', {item_guid: id}, result => {
      if (!result?.item || !result.type) throw new Error('播放信息无效');
      playInfo.value = result;
      play_guid.value = type === 'Movie' ? id : (result.item.parent_guid || id);
    })];
    if (type === 'TV') jobs.push(apply('GET', '/api/v1/season/list/' + id, {}, result => { SeasonData.value = result; }));
    else jobs.push(apply('POST', '/api/v1/person/list/' + id, {}, result => { PersonList.value = result.list.filter(person => person.role !== ''); }));
    if (type === 'season') jobs.push(apply('GET', '/api/v1/episode/list/' + id, {}, result => {
      if (!Array.isArray(result)) throw new Error('分集数据无效');
      EpisodeList.value = result; episodesReady.value = true;
    }));
    const results = await Promise.allSettled(jobs);
    const failed = results.find(result => result.status === 'rejected');
    if (current() && failed) loadError.value = failed.reason?.message || '部分信息加载失败，请重试';
  } catch (error) {
    if (current()) loadError.value = error?.message || '详情加载失败，请重试';
  } finally { if (current()) controller = null; }
}
function cancelActionUI() {
  if (actionBusy.value === 'batch') mediaActions?.stopBatch();
  actionGeneration++; actionBusy.value = ''; batchConfirm.value = null;
  batchProgress.value = null; batchResult.value = null; actionNote.value = ''; actionError.value = '';
}
async function setFlag(id, kind, enabled) {
  if (!mediaActions || actionBusy.value || !detailsReady.value) return;
  const ownDetail = id === guid.value;
  const allowed = kind === 'favorite' ? ownDetail && ['Movie', 'TV'].includes(gallery_type.value)
    : (ownDetail && gallery_type.value === 'Movie') || (gallery_type.value === 'season' && EpisodeList.value?.some(item => item.guid === id));
  if (!allowed) return;
  cancelDetail();
  const token = ++actionGeneration, parent = guid.value, account = viewAccount;
  const active = () => token === actionGeneration && parent === guid.value && account === COMMON.userKey && viewRevision === browseSnapshots.revision;
  actionBusy.value = `${kind}:${id}`; actionNote.value = ''; actionError.value = ''; batchResult.value = null;
  try {
    const result = await mediaActions.update({id, kind, enabled});
    if (!active() || result.superseded) return;
    if (result.item?.guid === guid.value) { VideoDataInfo.value = result.item; detailMediaRevision = mediaChanges.value; saveDetail(); }
    if (result.saved) actionNote.value = result.warning || '已保存';
    else actionError.value = result.error || '操作未确认，请刷新核对';
    await loadDetail();
  } catch (error) { if (active()) actionError.value = error?.message || '操作未确认，请刷新核对'; }
  finally { if (active()) actionBusy.value = ''; }
}
function openBatch(enabled) {
  if (!mediaActions || actionBusy.value || !episodesReady.value || gallery_type.value !== 'season') return;
  actionError.value = ''; actionNote.value = ''; batchResult.value = null;
  try {
    const ids = seasonTargets(guid.value, VideoDataInfo.value, EpisodeList.value);
    batchConfirm.value = {ids, enabled, season: guid.value, account: viewAccount, revision: viewRevision};
  } catch (error) { actionError.value = error.message; }
}
async function confirmBatch() {
  const plan = batchConfirm.value;
  if (!plan || actionBusy.value || !mediaActions) return;
  try {
    const currentIds = seasonTargets(guid.value, VideoDataInfo.value, EpisodeList.value);
    if (plan.season !== guid.value || plan.account !== COMMON.userKey || plan.revision !== browseSnapshots.revision ||
        JSON.stringify(plan.ids) !== JSON.stringify(currentIds)) throw new Error('分集范围已变化，请重新确认');
  } catch (error) { batchConfirm.value = null; actionError.value = error.message; return; }
  batchConfirm.value = null; cancelDetail();
  const token = ++actionGeneration, parent = guid.value;
  const active = () => token === actionGeneration && parent === guid.value && plan.account === COMMON.userKey && plan.revision === browseSnapshots.revision;
  actionBusy.value = 'batch'; batchProgress.value = {completed: 0, total: plan.ids.length};
  const labels = new Map(EpisodeList.value.map(item => [item.guid, item.title || `第 ${item.episode_number} 集`]));
  try {
    const result = await mediaActions.updateWatchedBatch(plan.ids, plan.enabled, {onProgress: progress => { if (active()) batchProgress.value = progress; }});
    if (!active() || result.superseded) return;
    batchResult.value = {...result, failed: result.failed.map(item => ({...item, title: labels.get(item.id) || item.id}))};
    await loadDetail();
  } catch (error) { if (active()) actionError.value = error?.message || '批量操作未确认，请刷新核对'; }
  finally { if (active()) { actionBusy.value = ''; actionNote.value = batchResult.value?.stopped ? '已停止后续操作' : ''; } }
}
function stopBatch() { mediaActions?.stopBatch(); actionNote.value = '正在停止，等待已发出的请求完成…'; }
function Play(id = play_guid.value) {
  if (!playInfo.value || !play_guid.value) return;
  proxy.$router.push({path: '/player', query: {gallery_type: playInfo.value.type, guid: play_guid.value,
    episode_guid: id !== play_guid.value ? id : undefined}});
}
onBeforeRouteUpdate(() => { saveDetail(); cancelDetail(); cancelActionUI(); });
onBeforeRouteLeave(() => { saveDetail(); cancelDetail(); cancelActionUI(); });
watch(() => [proxy.$route.query.guid, proxy.$route.query.gallery_type], ([id, type]) => {
  cancelDetail(); guid.value = id; gallery_type.value = type;
  viewAccount = COMMON.userKey; viewRevision = browseSnapshots.revision;
  detailMediaRevision = mediaChanges.value;
  void loadDetail(restoreDetail());
});
watch(() => browseSnapshots.revision, () => {
  cancelActionUI();
  cancelDetail(); VideoDataInfo.value = {}; SeasonData.value = PersonList.value = EpisodeList.value = null;
  playInfo.value = play_guid.value = backImg.value = null;
}, {flush: 'sync'});
onBeforeUnmount(() => { cancelDetail(); cancelActionUI(); });
onMounted(() => loadDetail(initialScroll));
</script>

<template>
  <div class="main-content media-detail">
    <div class="backdropContainer" :style="{backgroundImage: backImg ? `url(${backImg})` : ''}" aria-hidden="true"></div>
    <div class="view-backdrop">
      <PageBack />
      <div class="detail-shell">
        <n-alert v-if="loadError" type="error">{{ loadError }} <n-button text @click="loadDetail()">重试</n-button></n-alert>
        <n-alert v-if="actionError" type="error" class="media-action-notice">{{ actionError }}</n-alert>
        <p v-if="actionNote" role="status" class="media-action-notice">{{ actionNote }}</p>
        <section class="detail-hero">
          <div class="detail-poster"><MediaImage :src="VideoDataInfo.posters ? COMMON.imgUrl + '/92/17/' + VideoDataInfo.posters + '?w=500' : '/images/not_video.jpg'" :alt="detailTitle" loading="eager" /></div>
          <div class="detail-summary">
            <span class="media-type">{{ detailType }}</span><h1>{{ detailTitle }}</h1>
            <div class="detail-meta"><span v-if="VideoDataInfo.release_date">{{ String(VideoDataInfo.release_date).slice(0, 4) }}</span><span v-if="VideoDataInfo.vote_average > 0" class="detail-rating"><i class="bx bxs-star"></i>{{ Number(VideoDataInfo.vote_average).toFixed(1) }}</span><span v-if="EpisodeList?.length">{{ EpisodeList.length }} 集</span><span v-if="SeasonData?.length">{{ SeasonData.length }} 季</span></div>
            <button type="button" class="primary-play" @click="Play()" :disabled="!playInfo"><i class="bx bx-play"></i><span>{{ playInfo?.item?.watched_ts > 0 ? '继续观看' : '播放' }}</span><small v-if="gallery_type !== 'Movie' && playInfo?.item?.episode_number">第 {{ playInfo.item.episode_number }} 集</small></button>
            <div class="media-state-actions">
              <n-button v-if="['Movie', 'TV'].includes(gallery_type)" :disabled="Boolean(actionBusy) || !detailsReady || favoriteState === null" :aria-pressed="favoriteState === true" @click="setFlag(guid, 'favorite', !favoriteState)"><template #icon><i class="bx" :class="favoriteState ? 'bxs-star' : 'bx-star'"></i></template>{{ favoriteState ? '取消收藏' : '收藏' }}</n-button>
              <WatchlistButton v-if="detailsReady && ['Movie','TV'].includes(gallery_type)" :guid="guid" />
              <template v-if="gallery_type === 'Movie'"><span class="media-state-label">{{ watchedState === null ? '观看状态未获取' : watchedState ? '已看' : '未看' }}</span><n-button :disabled="Boolean(actionBusy) || !detailsReady || watchedState === true" @click="setFlag(guid, 'watched', true)">标为已看</n-button><n-button :disabled="Boolean(actionBusy) || !detailsReady || watchedState === false" @click="setFlag(guid, 'watched', false)">标为未看</n-button></template>
            </div>
            <p class="detail-overview" :class="{'is-expanded': expandedOverview}">{{ VideoDataInfo.overview || '暂无简介' }}</p><button v-if="VideoDataInfo.overview?.length > 150" type="button" class="text-action" @click="expandedOverview = !expandedOverview">{{ expandedOverview ? '收起简介' : '展开简介' }}</button>
          </div>
        </section>
        <section v-if="gallery_type === 'TV' && SeasonData?.length" class="detail-section"><div class="section-heading"><h2>季</h2><span>{{ SeasonData.length }} 季</span></div><div class="season-grid"><router-link v-for="item in SeasonData" :key="item.guid" :to="{path:'/video',query:{guid:item.guid,gallery_type:'season'}}" class="season-card"><div class="poster-art"><MediaImage :src="item.poster ? COMMON.imgUrl + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title" loading="lazy" /></div><div class="view-item-title">{{ item.title }}</div></router-link></div></section>
        <section v-if="gallery_type === 'season' && EpisodeList?.length" class="detail-section">
          <div class="section-heading"><h2>选集</h2><span>{{ EpisodeList.length }} 集</span></div>
          <div class="media-state-actions"><n-button :disabled="Boolean(actionBusy) || !episodesReady" @click="openBatch(true)">本季批量标为已看</n-button><n-button :disabled="Boolean(actionBusy) || !episodesReady" @click="openBatch(false)">本季批量标为未看</n-button></div>
          <div v-if="actionBusy === 'batch'" class="media-batch-summary" role="status">正在处理 {{ batchProgress?.completed || 0 }} / {{ batchProgress?.total || 0 }} 集 <n-button @click="stopBatch">停止后续操作</n-button></div>
          <div v-if="batchResult" class="media-batch-summary" role="status">已保存 {{ batchResult.saved.length }} 集，失败／未确认 {{ batchResult.failed.length }} 集，未执行 {{ batchResult.skipped.length }} 集。
            <ul v-if="batchResult.failed.length"><li v-for="item in batchResult.failed" :key="item.id">{{ item.title }}：{{ item.error }}</li></ul>
          </div>
          <div class="episode-grid"><div v-for="item in EpisodeList" :key="item.guid" class="episode-entry">
            <button type="button" class="episode-card" :class="{'is-current': playInfo?.item?.guid === item.guid}" @click="Play(item.guid)"><div class="episode-art"><MediaImage :src="item.poster ? COMMON.imgUrl + item.poster : '/images/not_gellery.png'" :alt="item.title" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span></div><div class="episode-caption"><strong>第 {{ item.episode_number }} 集</strong><span>{{ item.title }}</span></div></button>
            <div class="episode-state-actions"><span>{{ mediaFlag(item, 'watched') === null ? '状态未获取' : mediaFlag(item, 'watched') ? '已看' : '未看' }}</span><n-button size="small" :disabled="Boolean(actionBusy) || !episodesReady || mediaFlag(item, 'watched') === true" :aria-label="'将第 ' + item.episode_number + ' 集标为已看'" @click="setFlag(item.guid, 'watched', true)">已看</n-button><n-button size="small" :disabled="Boolean(actionBusy) || !episodesReady || mediaFlag(item, 'watched') === false" :aria-label="'将第 ' + item.episode_number + ' 集标为未看'" @click="setFlag(item.guid, 'watched', false)">未看</n-button></div>
          </div></div>
        </section>
        <section v-if="PersonList?.length" class="detail-section"><div class="section-heading"><h2>演职人员</h2></div><div class="cast-row"><div class="cast-card" v-for="(item,index) in PersonList" :key="item.id || index"><MediaImage :src="item.profile_path ? COMMON.imgUrl + '/t/p/w220_and_h330_face/' + item.profile_path : '/images/not_person.jpg'" :alt="item.name" loading="lazy" /><div>{{ item.name }}</div><span v-if="item.role">{{ item.role }}</span></div></div></section>
      </div>
    </div>
    <n-modal :show="Boolean(batchConfirm)" @update:show="value => { if (!value) batchConfirm = null; }">
      <n-card class="media-confirm-card" title="确认本季观看状态" role="dialog" aria-modal="true" aria-label="确认本季观看状态" :bordered="false">
        <p>将下列 {{ batchConfirm?.ids.length || 0 }} 集标为{{ batchConfirm?.enabled ? '已看' : '未看' }}。仅处理列出的分集，不修改其他季。</p>
        <ul class="media-confirm-list"><li v-for="item in batchItems" :key="item.guid">第 {{ item.episode_number }} 集 · {{ item.title }}</li></ul>
        <template #footer><div class="media-state-actions"><n-button @click="batchConfirm = null">取消</n-button><n-button type="primary" @click="confirmBatch">确认更新 {{ batchConfirm?.ids.length || 0 }} 集</n-button></div></template>
      </n-card>
    </n-modal>
  </div>
</template>

<style scoped>
.main-content{position:relative;isolation:isolate;min-height:100%;background:var(--cinema-bg)}
.backdropContainer{position:absolute;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:top center;background-repeat:no-repeat}
.view-backdrop{position:relative;min-height:calc(100dvh - 64px)}
.media-state-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:16px 0}.media-state-label,.episode-state-actions>span{font-size:12px;color:var(--cinema-muted)}
.media-action-notice{margin:12px 0}.episode-entry{min-width:0}.episode-entry>.episode-card{width:100%}.episode-state-actions{display:flex;align-items:center;gap:8px;padding:10px 0}.episode-state-actions>span{margin-right:auto}
.media-batch-summary{margin:16px 0;padding:14px;border:1px solid var(--cinema-line);border-radius:8px}.media-batch-summary ul{max-height:200px;overflow:auto}
.media-confirm-card{width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow-y:auto}.media-confirm-list{max-height:220px;overflow:auto;padding-left:22px;font-size:13px;line-height:1.8}
</style>

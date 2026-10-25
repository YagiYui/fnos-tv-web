<script setup>
import {computed, getCurrentInstance, onMounted, onBeforeUnmount, ref, inject, nextTick, watch} from 'vue';
import {onBeforeRouteUpdate, onBeforeRouteLeave} from 'vue-router';
import {useBrowseSnapshots} from '../../store.js';
import MediaImage from '../../components/MediaImage.vue';
import PageBack from '../../components/PageBack.vue';
import {mediaDetailTitle} from '../Play/player-presentation.js';

const proxy = getCurrentInstance().appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
const browseSnapshots = useBrowseSnapshots();
const pageScroll = inject('pageScroll', {getTop: () => window.scrollY, scrollTo: top => window.scrollTo(0, top)});
const guid = ref(proxy.$route.query.guid);
const gallery_type = ref(proxy.$route.query.gallery_type);
const VideoDataInfo = ref({});
const SeasonData = ref(null);
const PersonList = ref(null);
const EpisodeList = ref(null);
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
  updateBackdrop();
  return saved?.scrollY || 0;
}
function saveDetail() {
  if (!VideoDataInfo.value.guid) return;
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
    VideoDataInfo.value = info; updateBackdrop(); saveDetail();
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
    if (type === 'season') jobs.push(apply('GET', '/api/v1/episode/list/' + id, {}, result => { EpisodeList.value = result; }));
    const results = await Promise.allSettled(jobs);
    const failed = results.find(result => result.status === 'rejected');
    if (current() && failed) loadError.value = failed.reason?.message || '部分信息加载失败，请重试';
  } catch (error) {
    if (current()) loadError.value = error?.message || '详情加载失败，请重试';
  } finally { if (current()) controller = null; }
}
function Play(id = play_guid.value) {
  if (!playInfo.value || !play_guid.value) return;
  proxy.$router.push({path: '/player', query: {gallery_type: playInfo.value.type, guid: play_guid.value,
    episode_guid: id !== play_guid.value ? id : undefined}});
}
onBeforeRouteUpdate(() => { saveDetail(); cancelDetail(); });
onBeforeRouteLeave(() => { saveDetail(); cancelDetail(); });
watch(() => [proxy.$route.query.guid, proxy.$route.query.gallery_type], ([id, type]) => {
  cancelDetail(); guid.value = id; gallery_type.value = type;
  viewAccount = COMMON.userKey; viewRevision = browseSnapshots.revision;
  void loadDetail(restoreDetail());
});
watch(() => browseSnapshots.revision, () => {
  cancelDetail(); VideoDataInfo.value = {}; SeasonData.value = PersonList.value = EpisodeList.value = null;
  playInfo.value = play_guid.value = backImg.value = null;
}, {flush: 'sync'});
onBeforeUnmount(cancelDetail);
onMounted(() => loadDetail(initialScroll));
</script>

<template>
  <div class="main-content media-detail">
    <div class="backdropContainer" :style="{backgroundImage: backImg ? `url(${backImg})` : ''}" aria-hidden="true"></div>
    <div class="view-backdrop">
      <PageBack />
      <div class="detail-shell">
        <n-alert v-if="loadError" type="error">{{ loadError }} <n-button text @click="loadDetail()">重试</n-button></n-alert>
        <section class="detail-hero">
          <div class="detail-poster"><MediaImage :src="VideoDataInfo.posters ? COMMON.imgUrl + '/92/17/' + VideoDataInfo.posters + '?w=500' : '/images/not_video.jpg'" :alt="detailTitle" loading="eager" /></div>
          <div class="detail-summary">
            <span class="media-type">{{ detailType }}</span><h1>{{ detailTitle }}</h1>
            <div class="detail-meta"><span v-if="VideoDataInfo.release_date">{{ String(VideoDataInfo.release_date).slice(0, 4) }}</span><span v-if="VideoDataInfo.vote_average > 0" class="detail-rating"><i class="bx bxs-star"></i>{{ Number(VideoDataInfo.vote_average).toFixed(1) }}</span><span v-if="EpisodeList?.length">{{ EpisodeList.length }} 集</span><span v-if="SeasonData?.length">{{ SeasonData.length }} 季</span></div>
            <button type="button" class="primary-play" @click="Play()" :disabled="!playInfo"><i class="bx bx-play"></i><span>{{ playInfo?.item?.watched_ts > 0 ? '继续观看' : '播放' }}</span><small v-if="gallery_type !== 'Movie' && playInfo?.item?.episode_number">第 {{ playInfo.item.episode_number }} 集</small></button>
            <p class="detail-overview" :class="{'is-expanded': expandedOverview}">{{ VideoDataInfo.overview || '暂无简介' }}</p><button v-if="VideoDataInfo.overview?.length > 150" type="button" class="text-action" @click="expandedOverview = !expandedOverview">{{ expandedOverview ? '收起简介' : '展开简介' }}</button>
          </div>
        </section>
        <section v-if="gallery_type === 'TV' && SeasonData?.length" class="detail-section"><div class="section-heading"><h2>季</h2><span>{{ SeasonData.length }} 季</span></div><div class="season-grid"><router-link v-for="item in SeasonData" :key="item.guid" :to="{path:'/video',query:{guid:item.guid,gallery_type:'season'}}" class="season-card"><div class="poster-art"><MediaImage :src="item.poster ? COMMON.imgUrl + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title" loading="lazy" /></div><div class="view-item-title">{{ item.title }}</div></router-link></div></section>
        <section v-if="gallery_type === 'season' && EpisodeList?.length" class="detail-section"><div class="section-heading"><h2>选集</h2><span>{{ EpisodeList.length }} 集</span></div><div class="episode-grid"><button v-for="item in EpisodeList" :key="item.guid" type="button" class="episode-card" :class="{'is-current': playInfo?.item?.guid === item.guid}" @click="Play(item.guid)"><div class="episode-art"><MediaImage :src="item.poster ? COMMON.imgUrl + item.poster : '/images/not_gellery.png'" :alt="item.title" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span></div><div class="episode-caption"><strong>第 {{ item.episode_number }} 集</strong><span>{{ item.title }}</span></div></button></div></section>
        <section v-if="PersonList?.length" class="detail-section"><div class="section-heading"><h2>演职人员</h2></div><div class="cast-row"><div class="cast-card" v-for="(item,index) in PersonList" :key="item.id || index"><MediaImage :src="item.profile_path ? COMMON.imgUrl + '/t/p/w220_and_h330_face/' + item.profile_path : '/images/not_person.jpg'" :alt="item.name" loading="lazy" /><div>{{ item.name }}</div><span v-if="item.role">{{ item.role }}</span></div></div></section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-content{position:relative;isolation:isolate;min-height:100%;background:var(--cinema-bg)}
.backdropContainer{position:absolute;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:top center;background-repeat:no-repeat}
.view-backdrop{position:relative;min-height:calc(100dvh - 64px)}
</style>

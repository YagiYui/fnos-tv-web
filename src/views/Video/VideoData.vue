<script setup>
import {computed, getCurrentInstance, onMounted, ref} from "vue";
import {onBeforeRouteUpdate} from "vue-router";
import PageBack from '../../components/PageBack.vue';
import {mediaDetailTitle} from '../Play/player-presentation.js';

const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;

const per_view = ref(5);

const guid = ref(null);
const gallery_type = ref(null);
const VideoDataInfo = ref({})
const expandedOverview = ref(false);
const detailType = computed(() => ({Movie: '电影', TV: '剧集', season: '季'})[gallery_type.value] || '影片');
const detailTitle = computed(() => mediaDetailTitle(VideoDataInfo.value, gallery_type.value));
const SeasonData = ref(null)
const playInfo = ref(null)
const backImg = ref(null)
const siderRef = ref(null);
const PersonList = ref(null);
const EpisodeList = ref(null);
const EpisodeCarouselRef = ref(null);
const play_item_guid = ref(null);
const play_guid = ref(null)

guid.value = proxy.$route.query.guid
gallery_type.value = proxy.$route.query.gallery_type

// 获取剧集信息
async function GetVideoData() {
  let api = "/api/v1/item/" + guid.value;
  let res = await COMMON.requests("GET", api, true)
  VideoDataInfo.value = res;
  if (res.backdrops !== undefined) {
    backImg.value = COMMON.imgUrl + "/92/17/" + res.backdrops + "?w=200"
  } else {
    backImg.value = COMMON.imgUrl + "/92/17/" + VideoDataInfo.value.posters + "?w=200"
    // play_guid.value = VideoDataInfo.value.type === "Movie"?VideoDataInfo.value.guid:  VideoDataInfo.value.play_item_guid
  }
}

// 获取季信息
async function GetSeasonData() {
  let api = "/api/v1/season/list/" + guid.value;
  SeasonData.value = await COMMON.requests("GET", api, true)
}

// 获取播放信息
async function GetPayInfo() {
  let api = "/api/v1/play/info";
  let _data = {
    "item_guid": guid.value
  }
  playInfo.value = await COMMON.requests("POST", api, true, _data);
  play_guid.value = gallery_type.value === 'Movie' ? guid.value : (playInfo.value.item.parent_guid || guid.value);
}

async function GetPersonList() {
  let api = "/api/v1/person/list/" + guid.value;
  let res = await COMMON.requests("POST", api, true)
  PersonList.value = res.list.filter(o => o.role !== "");
}

async function GetEpisodeList() {
  let api = "/api/v1/episode/list/" + guid.value;
  EpisodeList.value = await COMMON.requests("GET", api, true);
}

async function Play(_guid = play_guid.value) {
  let _gallery_type = gallery_type.value;
  if(_gallery_type === "season"){
    _gallery_type = "TV"
  }
  proxy.$router.push({
    path: "/player",
    query: {
      gallery_type: playInfo.value.type,
      guid: play_guid.value,
      episode_guid: _guid !== play_guid.value ? _guid : undefined
    }
  })
}

const onMountedFun = async () => {
  // 获取剧集详情
  await GetVideoData();
  await GetPayInfo();
  // 获取剧集
  if (gallery_type.value === "TV") {
    await GetSeasonData();
  }
  if (gallery_type.value !== 'TV') {
    await GetPersonList();
  }
  if (gallery_type.value === 'season') {
    await GetEpisodeList()
  }
};


// 下一张
const goNext = () => {
  let _index = EpisodeCarouselRef.value.getCurrentIndex();
  EpisodeCarouselRef.value?.to(_index + per_view.value);
};

// 上一张
const goPrev = () => {
  let _index = EpisodeCarouselRef.value.getCurrentIndex();
  EpisodeCarouselRef.value?.to(_index - per_view.value);
};

// 跳转到指定索引（例如第二张图，索引从 0 开始）
const goToSlide = (index) => {
  EpisodeCarouselRef.value?.to(index);
};

onBeforeRouteUpdate(async (to, from) => {
  guid.value = to.query.guid;
  gallery_type.value = to.query.gallery_type
  SeasonData.value = null; EpisodeList.value = null; PersonList.value = null; expandedOverview.value = false;
  await onMountedFun();
});

onMounted(async () => {
  await onMountedFun();
})


</script>

<template>
  <div class="main-content media-detail">
    <div class="backdropContainer" :style="{backgroundImage: backImg ? `url(${backImg})` : ''}" aria-hidden="true"></div>
    <div class="view-backdrop">
      <PageBack />
      <div class="detail-shell">
        <section class="detail-hero">
          <div class="detail-poster"><img v-lazy="VideoDataInfo.posters ? COMMON.imgUrl + '/92/17/' + VideoDataInfo.posters + '?w=500' : '/images/not_video.jpg'" :alt="detailTitle"></div>
          <div class="detail-summary">
            <span class="media-type">{{ detailType }}</span><h1>{{ detailTitle }}</h1>
            <div class="detail-meta"><span v-if="VideoDataInfo.release_date">{{ String(VideoDataInfo.release_date).slice(0, 4) }}</span><span v-if="VideoDataInfo.vote_average > 0" class="detail-rating"><i class="bx bxs-star"></i>{{ Number(VideoDataInfo.vote_average).toFixed(1) }}</span><span v-if="EpisodeList?.length">{{ EpisodeList.length }} 集</span><span v-if="SeasonData?.length">{{ SeasonData.length }} 季</span></div>
            <button type="button" class="primary-play" @click="Play()" :disabled="!playInfo"><i class="bx bx-play"></i><span>{{ playInfo?.item?.watched_ts > 0 ? '继续观看' : '播放' }}</span><small v-if="gallery_type !== 'Movie' && playInfo?.item?.episode_number">第 {{ playInfo.item.episode_number }} 集</small></button>
            <p class="detail-overview" :class="{'is-expanded': expandedOverview}">{{ VideoDataInfo.overview || '暂无简介' }}</p><button v-if="VideoDataInfo.overview?.length > 150" type="button" class="text-action" @click="expandedOverview = !expandedOverview">{{ expandedOverview ? '收起简介' : '展开简介' }}</button>
          </div>
        </section>
        <section v-if="gallery_type === 'TV' && SeasonData?.length" class="detail-section"><div class="section-heading"><h2>季</h2><span>{{ SeasonData.length }} 季</span></div><div class="season-grid"><router-link v-for="item in SeasonData" :key="item.guid" :to="{path:'/video',query:{guid:item.guid,gallery_type:'season'}}" class="season-card"><div class="poster-art"><img v-lazy="item.poster ? COMMON.imgUrl + item.poster + '?w=300' : '/images/not_video.jpg'" :alt="item.title" loading="lazy"></div><div class="view-item-title">{{ item.title }}</div></router-link></div></section>
        <section v-if="gallery_type === 'season' && EpisodeList?.length" class="detail-section"><div class="section-heading"><h2>选集</h2><span>{{ EpisodeList.length }} 集</span></div><div class="episode-grid"><button v-for="item in EpisodeList" :key="item.guid" type="button" class="episode-card" :class="{'is-current': playInfo?.item?.guid === item.guid}" @click="Play(item.guid)"><div class="episode-art"><img v-lazy="item.poster ? COMMON.imgUrl + item.poster : '/images/not_gellery.png'" :alt="item.title" loading="lazy"><span class="poster-play"><i class="bx bx-play"></i></span></div><div class="episode-caption"><strong>第 {{ item.episode_number }} 集</strong><span>{{ item.title }}</span></div></button></div></section>
        <section v-if="PersonList?.length" class="detail-section"><div class="section-heading"><h2>演职人员</h2></div><div class="cast-row"><div class="cast-card" v-for="(item,index) in PersonList" :key="item.id || index"><img v-lazy="item.profile_path ? COMMON.imgUrl + '/t/p/w220_and_h330_face/' + item.profile_path : '/images/not_person.jpg'" :alt="item.name" loading="lazy"><div>{{ item.name }}</div><span v-if="item.role">{{ item.role }}</span></div></div></section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-content{position:relative;isolation:isolate;min-height:100%;background:var(--cinema-bg)}
.backdropContainer{position:absolute;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:top center;background-repeat:no-repeat}
.view-backdrop{position:relative;min-height:calc(100dvh - 64px)}
</style>

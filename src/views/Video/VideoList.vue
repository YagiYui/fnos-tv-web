<script setup>
// 获取 Vue 实例
import {getCurrentInstance, onMounted, onBeforeUnmount, ref, computed, watch} from "vue";
import {useMediaDbData} from '@/store.js'
import {onBeforeRouteUpdate} from "vue-router";

const MediaDbData = useMediaDbData()

const guid = ref(null);
const libraryTitle = computed(() => MediaDbData.list?.find(item => item.guid === guid.value)?.title || '媒体库');
const mode = computed({
  get: () => MediaDbData.sort_column,
  set: (value) => {
    MediaDbData.sort_column = value;
  }
});
const order = computed({
  get: () => MediaDbData.sort_type,
  set: (value) => {
    MediaDbData.sort_type = value;
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
const hasNextPage = computed(() => total.value !== null ? page.value * size.value < total.value : MediaDbInfo.value.length === size.value);
const totalPages = computed(() => total.value !== null ? Math.max(1, Math.ceil(total.value / size.value)) : null);


const instance = getCurrentInstance();
const proxy = instance.appContext.config.globalProperties;
const COMMON = proxy.$COMMON;
guid.value = proxy.$route.query.gallery_uid


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


async function GetMediaDbInfos(targetPage = page.value) {
  const generation = ++listGeneration;
  listLoading.value = true;
  listError.value = '';
  const request = {
    ancestor_guid: guid.value,
    tags: {type: ['Movie', 'TV', 'Directory', 'Video']},
    exclude_grouped_video: 1,
    page: targetPage,
    page_size: size.value,
    sort_type: MediaDbData.sort_type,
    sort_column: MediaDbData.sort_column
  };
  try {
    const res = await COMMON.requests('POST', '/api/v1/item/list', true, request);
    if (generation !== listGeneration) return;
    if (!Array.isArray(res?.list)) throw new Error('片库加载失败，请重试');
    if (targetPage > page.value && !res.list.length) {
      total.value = (page.value - 1) * size.value + MediaDbInfo.value.length;
      return;
    }
    MediaDbInfo.value = res.list;
    page.value = targetPage;
    const count = res.total == null ? NaN : Number(res.total);
    total.value = Number.isFinite(count) && count >= 0 ? count : null;
  } catch (error) {
    if (generation === listGeneration) listError.value = error?.message || '片库加载失败，请重试';
  } finally {
    if (generation === listGeneration) listLoading.value = false;
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
watch([mode, order], () => { void GetMediaDbInfos(1); });
onBeforeRouteUpdate(async to => {
  guid.value = to.query.gallery_uid;
  page.value = 1;
  total.value = null;
  MediaDbInfo.value = [];
  await GetMediaDbInfos(1);
});
onBeforeUnmount(() => { listGeneration++; });
onMounted(async () => { await GetMediaDbInfos(1); });
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

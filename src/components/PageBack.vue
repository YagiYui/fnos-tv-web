<script setup>
import {useRoute, useRouter} from 'vue-router';
import {NButton} from 'naive-ui';
import {pageBackAction} from '../navigation.js';
const route = useRoute();
const router = useRouter();
const homeTarget = () => ['/list', '/watchlist'].includes(route.path);
function goBack() {
  const action = pageBackAction(route, window.history.state?.back);
  if (action.type === 'back') router.back();
  else router.replace(action.to);
}
</script>

<template>
  <nav class="page-back-bar" aria-label="页面导航">
    <n-button secondary @click="goBack" :aria-label="homeTarget() ? '返回首页' : '返回上一页'">
      <template #icon><i class="bx bx-arrow-back" aria-hidden="true"></i></template>
      {{ homeTarget() ? '返回首页' : '返回' }}
    </n-button>
  </nav>
</template>

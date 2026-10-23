<script setup>
import {imageLoading, rememberImage} from '../image-loading.js';
defineProps({src: {type: String, required: true}, alt: {type: String, default: ''}, loading: {type: String, default: 'lazy'}});
</script>

<template>
  <img :src="src" :alt="alt" :loading="imageLoading(src, loading)" @load="rememberImage">
</template>

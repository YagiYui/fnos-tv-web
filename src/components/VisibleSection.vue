<script setup>
import {ref, onMounted, onBeforeUnmount} from 'vue';
import {observeSection} from '../visible-section.js';
const emit = defineEmits(['visible']);
const section = ref(null);
let stop;
onMounted(() => { stop = observeSection(section.value, () => emit('visible')); });
onBeforeUnmount(() => stop?.());
</script>

<template><section ref="section"><slot /></section></template>

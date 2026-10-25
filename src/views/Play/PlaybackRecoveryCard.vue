<script setup>
defineProps({message: String, busy: Boolean, lowerLabel: String, canExternal: Boolean});
defineEmits(['retry', 'lower', 'external', 'back']);
</script>

<template>
  <div class="playback-recovery-overlay" @click.stop @pointerdown.stop @touchstart.stop @keydown.stop>
    <section class="playback-recovery-card" role="alert" :aria-busy="busy">
      <div class="playback-recovery-heading"><strong>播放遇到问题</strong><button type="button" @click="$emit('back')">返回</button></div>
      <p>{{ busy ? '正在重新准备播放…' : message }}</p>
      <div class="playback-recovery-actions">
        <button type="button" :disabled="busy" @click="$emit('retry')">保留进度重试</button>
        <button v-if="lowerLabel" type="button" :disabled="busy" @click="$emit('lower')">降低画质重试 · {{ lowerLabel }}</button>
        <button v-if="canExternal" type="button" :disabled="busy" @click="$emit('external')">外部播放</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.playback-recovery-overlay{position:absolute;inset:0;z-index:180;display:flex;align-items:center;justify-content:center;padding:12px;background:#0009;box-sizing:border-box;cursor:auto;pointer-events:auto}
.playback-recovery-card{width:min(520px,100%);max-height:100%;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;box-sizing:border-box;padding:12px 16px;border:1px solid #ffffff40;border-radius:8px;background:#191d24;color:#fff;font:14px/1.5 sans-serif;text-align:left}
.playback-recovery-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.playback-recovery-card p{margin:8px 0 12px;overflow-wrap:anywhere}
.playback-recovery-actions{display:flex;gap:8px;flex-wrap:wrap}
.playback-recovery-card button{font:inherit;border:1px solid #ffffff50;border-radius:5px;background:#ffffff12;color:#fff;min-height:36px;padding:5px 10px;cursor:pointer}
.playback-recovery-card button:disabled{opacity:.5;cursor:wait}
.playback-recovery-card button:focus-visible{outline:2px solid #9ecbff;outline-offset:2px}
</style>

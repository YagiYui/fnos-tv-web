<template>
  <div ref="artRef"></div>
</template>

<script>
import Artplayer from 'artplayer';

// The page owns explicit recovery; do not reload an expired URL behind its error card.
Artplayer.RECONNECT_TIME_MAX = 0;

export default {
  data() {
    return {
      // instance: null,
    };
  },
  props: {
    shouldAutoplay: {type: Function, default: () => true},
    option: {
      type: Object,
      required: true,
    },
  },
  mounted() {
    const shouldAutoplay = this.shouldAutoplay;
    const instance = new Artplayer({
      ...this.option,
      container: this.$refs.artRef,
    }, function onReady(art) {
      // Pause/teardown and browser autoplay policy may reject this promise.
      // Native media errors continue through the page's recovery handlers.
      if (shouldAutoplay()) void this.play().catch(() => {});
    },);
    this._playerInstance = instance;
    this.$nextTick(() => {
      if (this._playerInstance === instance) this.$emit('get-instance', instance);
    });
  },
  beforeUnmount() {
    const instance = this._playerInstance;
    this._playerInstance = null;
    if (instance && instance.destroy) {
      instance.destroy(false);
    }
  },
};
</script>

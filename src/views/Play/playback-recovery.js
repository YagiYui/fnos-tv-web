const aborted = () => Object.assign(new Error('播放请求已取消'), {name: 'AbortError'});
export const isPlaybackAbort = error => ['AbortError', 'CanceledError'].includes(error?.name);

// Do not echo engine messages: they can contain signed URLs or session paths.
export function playbackFailureMessage(error) {
  const status = Number(error?.response?.status);
  if (status === 401 || status === 403 || /登录|鉴权/.test(error?.message || '')) return '登录或播放授权已失效，请重新登录后播放。';
  if (error?.code === 'PLAYBACK_TIMEOUT' || error?.code === 'ECONNABORTED') return '等待视频响应超时，可保留进度重试。';
  if (error?.category === 'decode' || error?.code === 3 || error?.code === 4) return '当前视频无法解码，可降低画质或使用外部播放器。';
  if (error?.category === 'network' || error?.code === 2 || error?.code === 'ERR_NETWORK' || status >= 500) return '视频连接中断或服务暂时不可用，可保留进度重试。';
  return '视频暂时无法播放，可重新获取播放链接后重试。';
}

export function lowerPlaybackQuality(qualities, current) {
  const height = value => {
    const text = String(value || '').toLowerCase();
    if (text === '4k') return 2160;
    return /^\d+p?$/.test(text) ? Number(text.replace('p', '')) : NaN;
  };
  const rate = Number(current?.bitrate), size = height(current?.resolution);
  if (!(rate > 0) || !Number.isFinite(size)) return null;
  return (qualities || []).filter(item => Number(item.bitrate) > 0 && Number(item.bitrate) < rate
    && height(item.resolution) <= size).sort((a, b) => Number(b.bitrate) - Number(a.bitrate))[0] || null;
}

// A failed future HLS request must not stop media that is still buffered and decodable.
export function bufferedPlaybackFailure(player, onFailure, {isCurrent = () => true, resume = () => {}, win = window} = {}) {
  let pending = null, timer = null, disposed = false;
  const reset = () => { pending = null; win.clearTimeout(timer); timer = null; };
  function check() {
    win.clearTimeout(timer);
    if (disposed || !pending) return;
    if (!isCurrent() || player.video.ended) { reset(); return; }
    const video = player.video, time = Number(player.currentTime) || 0;
    let buffered = false;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= time + .05 && video.buffered.end(i) > time + .25) buffered = true;
    }
    if (!video.error && (buffered || (video.paused && video.readyState >= 2))) {
      timer = win.setTimeout(check, 250);
      return;
    }
    const error = pending; reset(); onFailure(error);
  }
  function notify(error) {
    if (disposed || !isCurrent()) return;
    if (error?.category !== 'network' && error?.code !== 2 && error?.code !== 'ERR_NETWORK') { reset(); onFailure(error); return; }
    pending = error; check();
  }
  const online = () => { if (pending && isCurrent()) resume(); };
  const loaded = () => { if (isCurrent()) reset(); };
  const events = ['video:waiting', 'video:stalled', 'video:timeupdate', 'video:seeked', 'video:play'];
  for (const event of events) player.on(event, check);
  player.on('fnos:network-ready', loaded);
  win.addEventListener('online', online);
  return {notify, reset, dispose() {
    disposed = true; reset();
    for (const event of events) player.off(event, check);
    player.off('fnos:network-ready', loaded);
    win.removeEventListener('online', online);
  }};
}

// Own and remove listeners on success, failure, timeout and superseding navigation.
// Artplayer.switchUrl leaves once-listeners behind on error and never settles for an identical URL.
export function switchRecoverableSource(player, source, {signal, position = 0, paused = false, timeout = 45000} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    let timer, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      for (const [event, handler] of listeners) player.off(event, handler);
      error ? reject(error) : resolve();
    };
    const cancel = () => finish(aborted());
    const failed = error => finish(error?.category || error?.code ? error : player.video?.error || new Error('视频加载失败'));
    const ready = async () => {
      if (finished) return;
      try {
        player.currentTime = Math.max(0, Number(position) || 0);
        // Remove callbacks before play() can trigger another media event.
        finish();
        if (paused) player.pause();
        else await player.play();
      } catch (error) {
        if (!finished) finish(error);
        // Browser autoplay restrictions leave the ordinary play control available.
      }
    };
    const listeners = [['video:canplay', ready], ['video:error', failed], ['fnos:media-error', failed], ['destroy', cancel]];
    for (const [event, handler] of listeners) player.on(event, handler);
    signal?.addEventListener('abort', cancel, {once: true});
    timer = setTimeout(() => finish(Object.assign(new Error('视频响应超时'), {code: 'PLAYBACK_TIMEOUT'})), timeout);
    try {
      player.pause();
      player.template?.$player?.classList.remove('art-error');
      player.url = source;
    } catch (error) { finish(error); }
  });
}

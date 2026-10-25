// Wall-clock deadline survives delayed browser timers; no timers run after cancel/dispose.
export function createSleepTimer({onStop, onChange = () => {}, now = () => Date.now(), schedule = setTimeout, clear = clearTimeout}) {
  let deadline = 0, mode = 'off', expired = false, timer = null, disposed = false;
  function state() { return {mode, expired, remaining: deadline ? Math.max(0, Math.ceil((deadline - now()) / 1000)) : 0}; }
  function cancel() {
    if (timer !== null) clear(timer);
    timer = null; deadline = 0; mode = 'off'; expired = false;
    onChange(state());
  }
  function stop() {
    if (mode === 'off' || expired || disposed) return;
    if (timer !== null) clear(timer);
    timer = null; deadline = 0; expired = true;
    onChange(state()); onStop();
  }
  function check() {
    if (timer !== null) clear(timer);
    timer = null;
    if (disposed || mode !== 'timer' || expired) return;
    if (deadline <= now()) { stop(); return; }
    onChange(state());
    timer = schedule(check, Math.min(1000, Math.max(1, deadline - now())));
  }
  return {
    state,
    cancel,
    set(minutes) {
      if (disposed) return;
      if (!Number.isInteger(minutes) || ![-1,0,15,30,60,90,120].includes(minutes)) throw new Error('定时范围无效');
      cancel();
      if (!minutes) return;
      mode = minutes === -1 ? 'episode' : 'timer';
      deadline = minutes > 0 ? now() + minutes * 60000 : 0;
      if (minutes > 0) check(); else onChange(state());
    },
    check,
    ended() { check(); if (mode === 'episode') stop(); },
    allowsAutoplay() { check(); return !expired && mode !== 'episode'; },
    dispose() { cancel(); disposed = true; }
  };
}

export function pictureInPictureAvailable(video, document) {
  return Boolean(document?.pictureInPictureEnabled && video && !video.disablePictureInPicture && typeof video.requestPictureInPicture === 'function');
}

export function togglePictureInPicture(video, document) {
  if (!pictureInPictureAvailable(video, document)) return Promise.reject(new Error('当前浏览器不支持画中画'));
  if (document.pictureInPictureElement === video) return document.exitPictureInPicture();
  // Called directly from a click; do not lose the required user activation through awaits.
  return video.requestPictureInPicture();
}

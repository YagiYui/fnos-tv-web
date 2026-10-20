// Keep the entire player in fullscreen so ASS/PGS and danmaku stay visible.
export function installMobileFullscreen(art, win = window, doc = document) {
  const player = art.template.$player;
  const video = art.template.$video;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(win.navigator.userAgent) ||
    (win.navigator.maxTouchPoints > 1 && win.matchMedia('(pointer: coarse)').matches);
  if (!mobile) return () => {};
  art.constructor.FULLSCREEN_WEB_IN_BODY = true;
  player.classList.add('fnos-touch-player');
  let nativeActive = false, destroyed = false, frame = 0, orientationEpoch = 0, ownsLock = false;
  const properties = ['width', 'height', 'max-width', 'max-height', 'transform', 'transform-origin'];
  let original = null;
  let pageOverflow = null;
  function restore() {
    if (original) {
      for (const [name, value, priority] of original) {
        if (value) player.style.setProperty(name, value, priority);
        else player.style.removeProperty(name);
      }
      original = null;
    }
    player.classList.remove('fnos-landscape-rotated');
    art.isRotate = false;
  }
  function layout() {
    if (destroyed) return;
    restore();
    const active = nativeActive || art.fullscreenWeb;
    player.classList.toggle('fnos-mobile-fullscreen', Boolean(active));
    if (!active) { art.emit('resize'); return; }
    const width = doc.documentElement.clientWidth || win.innerWidth;
    const height = doc.documentElement.clientHeight || win.innerHeight;
    const rotated = width < height && (!video.videoWidth || video.videoWidth >= video.videoHeight);
    player.style.setProperty('--fnos-player-height', `${rotated ? width : height}px`);
    // Metadata can arrive after the fullscreen gesture; default to landscape then.
    if (rotated) {
      original = properties.map(name => [name, player.style.getPropertyValue(name), player.style.getPropertyPriority(name)]);
      for (const [name, value] of Object.entries({width: `${height}px`, height: `${width}px`,
        'max-width': 'none', 'max-height': 'none', 'transform-origin': '0 0',
        transform: `rotate(90deg) translateY(-${width}px)`})) player.style.setProperty(name, value, 'important');
      player.classList.add('fnos-landscape-rotated');
      art.isRotate = true;
    }
    art.emit('resize');
  }
  function schedule() { win.cancelAnimationFrame(frame); frame = win.requestAnimationFrame(layout); }
  async function nativeChanged(state) {
    nativeActive = state;
    const epoch = ++orientationEpoch;
    schedule();
    const orientation = win.screen?.orientation;
    if (state && orientation?.lock) {
      try {
        await orientation.lock(video.videoHeight > video.videoWidth ? 'portrait' : 'landscape');
        if (destroyed || epoch !== orientationEpoch) { if (!nativeActive) orientation.unlock?.(); return; }
        ownsLock = true;
      } catch { /* HTTP and some mobile browsers reject orientation locks; layout rotates instead. */ }
      schedule();
    } else if (!state && ownsLock) { orientation?.unlock?.(); ownsLock = false; }
  }
  function webChanged(state) {
    if (state && !pageOverflow) {
      pageOverflow = [doc.body.style.overflow, doc.documentElement.style.overflow];
      doc.body.style.overflow = doc.documentElement.style.overflow = 'hidden';
    } else if (!state && pageOverflow) {
      [doc.body.style.overflow, doc.documentElement.style.overflow] = pageOverflow;
      pageOverflow = null;
    }
    // fullscreenWeb saves/restores inline styles; avoid capturing our rotated styles on exit.
    if (!state) original = null;
    schedule();
  }
  async function toggle() {
    if (nativeActive || art.fullscreenWeb) {
      restore();
      if (art.fullscreenWeb) art.fullscreenWeb = false;
      if (nativeActive) {
        try { await (doc.exitFullscreen?.() || doc.webkitExitFullscreen?.()); } catch {}
      }
      return;
    }
    // Request the element directly so rejected promises can fall back without an unhandled rejection.
    const request = player.requestFullscreen || player.webkitRequestFullscreen;
    if (request) {
      try { await request.call(player); return; } catch {}
    }
    art.fullscreenWeb = true;
  }
  art.controls.add({name: 'mobile-fullscreen', position: 'right', index: 100,
    html: '<span aria-hidden="true">⛶</span>', tooltip: '横屏全屏 / 退出全屏',
    mounted: element => { element.setAttribute('aria-label', '横屏全屏 / 退出全屏'); element.setAttribute('role', 'button'); element.tabIndex = 0;
      art.proxy(element, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); void toggle();} }); },
    click: () => { void toggle(); }});
  art.on('fullscreen', nativeChanged);
  art.on('fullscreenWeb', webChanged);
  art.on('video:loadedmetadata', schedule);
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  return () => {
    destroyed = true; ++orientationEpoch; win.cancelAnimationFrame(frame);
    if (art.fullscreenWeb) art.fullscreenWeb = false;
    art.off('fullscreen', nativeChanged); art.off('fullscreenWeb', webChanged);
    art.off('video:loadedmetadata', schedule);
    win.removeEventListener('resize', schedule); win.removeEventListener('orientationchange', schedule);
    if (ownsLock) win.screen?.orientation?.unlock?.();
    restore();
  };
}

// Fullscreen navigation is shared by the on-screen back button and router guard.
export function exitPlayerFullscreen(art) {
  if (!art || !(art.fullscreen || art.fullscreenWeb)) return false;
  if (art.fullscreenWeb) art.fullscreenWeb = false;
  if (art.fullscreen) art.fullscreen = false;
  return true;
}

// Keep useful errors and loading notices, suppress only redundant transport messages.
export function installPlaybackNoticeFilter(art) {
  const notice = art.notice;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(notice), 'show');
  if (!descriptor?.set) return () => {};
  const ignored = new Set(['Play', 'Pause', '播放', '暂停', art.i18n.get('Play'), art.i18n.get('Pause')]);
  Object.defineProperty(notice, 'show', {configurable: true, set(message) {
    if (!ignored.has(message)) descriptor.set.call(this, message);
  }});
  return () => { delete notice.show; };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Coordinates follow the visible video axes, including our CSS landscape rotation.
function point(player, touch, rotated) {
  const rect = player.getBoundingClientRect();
  return rotated
    ? {x: touch.clientY - rect.top, y: rect.right - touch.clientX, width: rect.height, height: rect.width}
    : {x: touch.clientX - rect.left, y: touch.clientY - rect.top, width: rect.width, height: rect.height};
}

export function installMobileGestures(art, win = window, doc = document) {
  const player = art.template.$player;
  if (!player.classList.contains('fnos-touch-player')) return () => {};
  const video = art.template.$video;
  const hud = doc.createElement('div');
  hud.className = 'fnos-gesture-hud';
  hud.setAttribute('role', 'status');
  hud.setAttribute('aria-live', 'polite');
  hud.hidden = true;
  player.append(hud);
  let session = null, holdTimer = 0, hideTimer = 0, suppressUntil = 0, brightness = 1;
  const initialFilter = video.style.filter;
  const active = () => Boolean(art.fullscreen || art.fullscreenWeb);
  function show(text) { win.clearTimeout(hideTimer); hud.textContent = text; hud.hidden = false; }
  function finish() {
    win.clearTimeout(holdTimer);
    if (session?.mode === 'speed') {
      art.playbackRate = session.rate;
      art.fnosTemporarySpeed = false;
    }
    if (session?.mode) suppressUntil = Date.now() + 500;
    session = null;
    hideTimer = win.setTimeout(() => {hud.hidden = true;}, 450);
  }
  const excluded = 'button,a,input,select,textarea,[role="button"],.art-bottom,.art-settings,.art-selector-list,.fnos-danmaku-panel,.art-mask';
  function start(event) {
    finish();
    if (!active() || art.isLock || event.touches.length !== 1 || event.target.closest(excluded)) return;
    const p = point(player, event.touches[0], art.isRotate);
    // Keep the outer edge available for OS navigation gestures.
    if (p.x < 24 || p.x > p.width - 24 || p.y < 48 || p.y > p.height - 64) return;
    session = {...p, id: event.touches[0].identifier, mode: '', volume: art.volume,
      brightness, time: art.currentTime, rate: art.playbackRate, seek: art.currentTime};
    holdTimer = win.setTimeout(() => {
      if (!session || session.mode || !art.playing || art.isLock) return;
      session.mode = 'speed';
      art.fnosTemporarySpeed = true;
      art.playbackRate = Math.max(2, session.rate);
      show(`${art.playbackRate}× 加速播放 · 松手恢复`);
    }, 450);
  }
  function move(event) {
    if (!session) return;
    if (event.touches.length !== 1 || !active() || art.isLock) {finish(); return;}
    const touch = [...event.touches].find(t => t.identifier === session.id);
    if (!touch) {finish(); return;}
    const p = point(player, touch, art.isRotate);
    const dx = p.x - session.x, dy = p.y - session.y;
    if (!session.mode) {
      if (Math.hypot(dx, dy) < 12) return;
      win.clearTimeout(holdTimer);
      if (Math.abs(dy) > Math.abs(dx) * 1.3) session.mode = session.x < session.width / 2 ? 'brightness' : 'volume';
      else if (Math.abs(dx) > Math.abs(dy) * 1.3) session.mode = 'seek';
      else return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (session.mode === 'brightness') {
      brightness = clamp(session.brightness - dy / (session.height * 0.8), 0.2, 1);
      video.style.filter = `${initialFilter} brightness(${brightness})`.trim();
      show(`画面亮度 ${Math.round(brightness * 100)}%`);
    } else if (session.mode === 'volume') {
      const target = clamp(session.volume - dy / (session.height * 0.8), 0, 1);
      try {art.volume = target;} catch {show('请使用设备音量键'); return;}
      if (Math.abs(art.volume - target) > 0.02) show('此浏览器请使用设备音量键');
      else {if (target > 0) art.muted = false; show(`播放器音量 ${Math.round(art.volume * 100)}%`);}
    } else if (session.mode === 'seek' && Number.isFinite(art.duration) && art.duration > 0) {
      session.seek = clamp(session.time + dx / session.width * Math.min(120, art.duration), 0, Math.max(0, art.duration - 0.1));
      const seconds = Math.round(session.seek);
      show(`${dx < 0 ? '快退' : '快进'} ${Math.abs(Math.round(session.seek - session.time))}秒 · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    }
  }
  function end(event) {
    if (session?.mode) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === 'touchend' && session.mode === 'seek') art.seek = session.seek;
    }
    finish();
  }
  function click(event) {
    if (Date.now() < suppressUntil) {event.preventDefault(); event.stopImmediatePropagation();}
  }
  function cancel() {finish();}
  function context(event) {if (session) event.preventDefault();}
  function changed() {if (!active()) {finish(); hud.hidden = true;}}
  const events = [['touchstart', start], ['touchmove', move], ['touchend', end], ['touchcancel', end], ['click', click], ['contextmenu', context]];
  for (const [name, fn] of events) player.addEventListener(name, fn, {capture: true, passive: false});
  win.addEventListener('blur', cancel);
  win.addEventListener('resize', cancel);
  win.addEventListener('orientationchange', cancel);
  doc.addEventListener('visibilitychange', cancel);
  art.on('fullscreen', changed); art.on('fullscreenWeb', changed);
  art.on('video:pause', cancel); art.on('video:ended', cancel); art.on('video:loadstart', cancel);
  return () => {
    finish(); win.clearTimeout(hideTimer);
    for (const [name, fn] of events) player.removeEventListener(name, fn, true);
    win.removeEventListener('blur', cancel); win.removeEventListener('resize', cancel);
    win.removeEventListener('orientationchange', cancel); doc.removeEventListener('visibilitychange', cancel);
    art.off('fullscreen', changed); art.off('fullscreenWeb', changed);
    art.off('video:pause', cancel); art.off('video:ended', cancel); art.off('video:loadstart', cancel);
    video.style.filter = initialFilter; hud.remove();
  };
}

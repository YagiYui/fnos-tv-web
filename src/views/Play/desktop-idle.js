// Coordinate application overlays with Artplayer's existing control visibility state.
export function installDesktopIdle(art, win = window) {
  const player = art.template.$player;
  if (player.classList.contains('fnos-touch-player')) return () => {};
  let timer = null, disposed = false, overControls = false;
  const delay = art.constructor.CONTROL_HIDE_TIME || 3000;
  const protectedSelector = '.art-control,.art-progress,.art-settings,.art-selector-list,.artplayer-plugin-danmuku,.art-back-button';
  function schedule(ms = delay) {
    win.clearTimeout(timer); timer = win.setTimeout(check, ms);
  }
  function wake() {
    if (disposed) return;
    player.classList.remove('fnos-desktop-idle');
    art.controls.show = true;
    schedule();
  }
  function check() {
    if (disposed) return;
    if (!art.playing) { player.classList.remove('fnos-desktop-idle'); return; }
    if (overControls || art.setting.show || art.isInput || player.querySelector(':focus-visible')) {
      schedule(500); return;
    }
    player.classList.add('fnos-desktop-idle');
    art.controls.show = false;
  }
  function move(event) {
    if (event.pointerType === 'touch') return;
    overControls = Boolean(event.target?.closest?.(protectedSelector));
    wake();
  }
  function leave() { overControls = false; schedule(0); }
  function pause() { player.classList.remove('fnos-desktop-idle'); win.clearTimeout(timer); art.controls.show = true; }
  const listeners = [['pointermove', move], ['pointerdown', move], ['keydown', wake], ['focusin', wake], ['pointerleave', leave]];
  for (const [name, fn] of listeners) player.addEventListener(name, fn);
  art.on('video:playing', wake); art.on('video:pause', pause);
  art.on('fullscreen', wake); art.on('fullscreenWeb', wake);
  wake();
  return () => {
    disposed = true; win.clearTimeout(timer);
    for (const [name, fn] of listeners) player.removeEventListener(name, fn);
    art.off('video:playing', wake); art.off('video:pause', pause);
    art.off('fullscreen', wake); art.off('fullscreenWeb', wake);
    player.classList.remove('fnos-desktop-idle');
  };
}

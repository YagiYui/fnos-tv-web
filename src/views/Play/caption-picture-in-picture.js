export function captionPictureInPictureAvailable(win = window) {
  return Boolean(win.isSecureContext && typeof win.documentPictureInPicture?.requestWindow === 'function');
}

// Move the same player, not a second video or a subtitle screenshot. This keeps
// DOM captions, ASS/PGS canvases, danmaku and the current media engine together.
export function installCaptionPictureInPicture(player, win = window, doc = document) {
  const root = player.template.$player;
  let floating = null, placeholder = null, parent = null, next = null;
  let epoch = 0, pending = false, disposed = false, cleanControls = () => {};
  let relocationState = null, cancelRelocation = () => {};
  const oldDisablePiP = player.video.disablePictureInPicture;
  if (captionPictureInPictureAvailable(win)) player.video.disablePictureInPicture = true;

  function movePlayer(move) {
    const video = player.video;
    const state = (video.readyState < 1 ? relocationState : null) || {position: player.currentTime, paused: video.paused, rate: video.playbackRate};
    cancelRelocation(); relocationState = state;
    const source = video.getAttribute('src'), generation = player.fnosSourceGeneration;
    const apply = () => {
      if (disposed || source !== video.getAttribute('src') || generation !== player.fnosSourceGeneration || video.readyState < 1) return;
      video.currentTime = Number.isFinite(state.position) ? state.position : 0;
      video.playbackRate = state.rate;
      if (state.paused) player.pause(); else void player.play().catch(() => {});
    };
    const metadata = () => { apply(); cancelRelocation(); };
    video.addEventListener('loadedmetadata', metadata);
    const timeout = win.setTimeout(() => cancelRelocation(), 5000);
    cancelRelocation = () => { video.removeEventListener('loadedmetadata', metadata); win.clearTimeout(timeout); relocationState = null; cancelRelocation = () => {}; };
    move(); apply();
  }

  function restore(attach = true) {
    cleanControls(); cleanControls = () => {};
    root.classList.remove('fnos-document-pip');
    if (placeholder) {
      if (attach && placeholder.parentNode) movePlayer(() => placeholder.replaceWith(root));
      else { cancelRelocation(); root.remove(); placeholder.remove(); }
    } else if (attach && parent?.isConnected && root.parentNode !== parent) {
      movePlayer(() => parent.insertBefore(root, next?.parentNode === parent ? next : null));
    }
    placeholder = null; parent = null; next = null; floating = null;
    if (attach && !disposed) {
      player.emit('resize');
    }
  }
  function close(attach = true) {
    epoch++; pending = false;
    const target = floating;
    if (target) { restore(attach); target.close(); }
  }
  async function toggle() {
    if (disposed) return;
    if (floating || pending) { close(); return; }
    if (!captionPictureInPictureAvailable(win)) throw new Error('当前浏览器不支持带字幕画中画，请使用桌面版 Edge／Chrome，或使用网页全屏');
    const operation = ++epoch;
    pending = true;
    let target;
    try {
      // Must be requested in the original click, before waiting for any other work.
      target = await win.documentPictureInPicture.requestWindow({width: 640, height: 404});
      if (disposed || operation !== epoch || !root.isConnected) { target.close(); return; }
      floating = target;
      const pipDoc = target.document;
      pipDoc.title = 'FNOS TV · 画中画';
      const base = pipDoc.createElement('base'); base.href = doc.baseURI; pipDoc.head.append(base);
      for (const sheet of doc.styleSheets) {
        try {
          const style = pipDoc.createElement('style');
          style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join('\n');
          pipDoc.head.append(style);
        } catch {
          if (sheet.href) { const link = pipDoc.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; pipDoc.head.append(link); }
        }
      }
      const style = pipDoc.createElement('style');
      style.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:#eee;font:13px system-ui,sans-serif}
        .art-video-player.fnos-document-pip{position:relative!important;width:100%!important;height:calc(100dvh - 44px)!important;max-width:none!important;max-height:none!important;transform:none!important;border-radius:0!important}
        .fnos-document-pip .art-bottom,.fnos-document-pip .art-layer-title,.fnos-document-pip .art-layer-danmuTitle,.fnos-document-pip .art-layer-mobile-danmaku,.fnos-document-pip .art-settings,.fnos-document-pip .art-mask{display:none!important}
        .fnos-document-pip .art-subtitle{font-size:clamp(14px,3.4vw,24px)!important}
        .pip-controls{height:44px;display:flex;align-items:center;gap:10px;padding:0 10px;box-sizing:border-box;background:#15181f}
        .pip-controls button{border:0;border-radius:6px;background:#ffffff16;color:#fff;min-height:32px;padding:0 10px;white-space:nowrap;cursor:pointer;font:inherit}
        .pip-controls input{min-width:30px;flex:1;accent-color:#80b7ff}.pip-controls output{white-space:nowrap;font-variant-numeric:tabular-nums}
        .pip-controls button:focus-visible,.pip-controls input:focus-visible{outline:2px solid #80b7ff;outline-offset:2px}
        @media(max-width:380px){.pip-controls{gap:6px}.pip-controls output{display:none}}`;
      pipDoc.head.append(style);
      parent = root.parentNode; next = root.nextSibling;
      placeholder = doc.createElement('div'); placeholder.className = 'fnos-pip-placeholder';
      placeholder.style.cssText = `min-height:${Math.max(180, root.getBoundingClientRect().height)}px;display:flex;align-items:center;justify-content:center;gap:16px;color:var(--cinema-muted);background:#15181f;border-radius:8px`;
      const notice = doc.createElement('span'); notice.textContent = '正在画中画中播放';
      const back = doc.createElement('button'); back.type = 'button'; back.textContent = '返回网页播放'; back.onclick = () => close();
      back.style.cssText = 'font:inherit;padding:8px 12px;border:1px solid #ffffff40;border-radius:8px;color:#fff;background:transparent;cursor:pointer';
      placeholder.append(notice, back); parent.insertBefore(placeholder, root);
      root.classList.add('fnos-document-pip'); movePlayer(() => pipDoc.body.append(root));
      const controls = pipDoc.createElement('div'); controls.className = 'pip-controls';
      const play = pipDoc.createElement('button'); play.type = 'button';
      const seek = pipDoc.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '100'; seek.step = '.1'; seek.setAttribute('aria-label', '播放进度');
      const time = pipDoc.createElement('output');
      const returnButton = pipDoc.createElement('button'); returnButton.type = 'button'; returnButton.textContent = '返回网页'; returnButton.onclick = () => close();
      const format = seconds => { const value = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; };
      const update = () => {
        play.textContent = player.video.paused ? '播放' : '暂停'; play.setAttribute('aria-label', play.textContent);
        const duration = Number.isFinite(player.duration) ? player.duration : 0;
        seek.disabled = !duration; seek.value = duration ? String(player.currentTime / duration * 100) : '0';
        time.textContent = `${format(player.currentTime)} / ${format(duration)}`;
      };
      play.onclick = () => player.video.paused ? void player.play().catch(() => {}) : player.pause();
      seek.oninput = () => { if (Number.isFinite(player.duration) && player.duration > 0) player.currentTime = Number(seek.value) / 100 * player.duration; };
      controls.append(play, seek, time, returnButton); pipDoc.body.append(controls);
      const events = ['video:timeupdate', 'video:play', 'video:pause', 'video:durationchange'];
      for (const name of events) player.on(name, update);
      cleanControls = () => { for (const name of events) player.off(name, update); };
      target.addEventListener('pagehide', () => { if (floating === target) restore(!disposed); }, {once: true});
      player.emit('resize'); update();
    } catch (error) {
      if (target) { if (floating === target) restore(!disposed); target.close(); }
      if (!disposed && operation === epoch) throw error;
    } finally { if (operation === epoch) pending = false; }
  }
  function dispose() { disposed = true; cancelRelocation(); close(false); player.video.disablePictureInPicture = oldDisablePiP; win.removeEventListener('pagehide', pagehide); }
  function pagehide() { close(); }
  const controller = {toggle, close, dispose, get active() { return Boolean(floating); }};
  player.fnosCaptionPiP = controller;
  win.addEventListener('pagehide', pagehide);
  player.on('destroy', dispose);
  return controller;
}

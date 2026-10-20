// Use the plugin's configuration API; keep touch controls out of the transport row.
export function installMobileDanmaku(art, doc = document) {
  const player = art.template.$player;
  const plugin = art.plugins.artplayerPluginDanmuku;
  if (!player.classList.contains('fnos-touch-player') || !plugin) return () => {};
  const toolbar = doc.createElement('div');
  toolbar.className = 'fnos-danmaku-tools';
  const toggle = doc.createElement('button');
  const settings = doc.createElement('button');
  toggle.type = settings.type = 'button';
  settings.textContent = '弹幕设置';
  settings.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('section');
  panel.className = 'fnos-danmaku-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', '弹幕设置');
  const inputs = [];
  function close() { if (!panel.hidden) art.isInput = false; panel.hidden = true; settings.setAttribute('aria-expanded', 'false'); }
  function sync() {
    toggle.textContent = plugin.isHide ? '弹幕 关' : '弹幕 开';
    toggle.setAttribute('aria-label', plugin.isHide ? '打开弹幕' : '关闭弹幕');
    toggle.setAttribute('aria-pressed', String(!plugin.isHide));
    for (const {input, output, key, format} of inputs) {
      const value = plugin.option[key];
      input.value = key === 'fontSize' && typeof value === 'string' && value.endsWith('%')
        ? Math.max(8, Math.min(60, Math.round(player.clientWidth * parseFloat(value) / 100))) : value;
      output.textContent = format(Number(input.value));
    }
  }
  function fit() { panel.style.maxHeight = `${Math.max(80, player.clientHeight - 72)}px`; }
  for (const [key, title, min, max, step, format] of [
    ['opacity', '不透明度', 0.1, 1, 0.1, value => `${Math.round(value * 100)}%`],
    ['fontSize', '字号', 8, 60, 1, value => `${value}px`],
    ['speed', '显示时长', 1, 10, 0.5, value => `${value}秒`],
  ]) {
    const label = doc.createElement('label');
    const name = doc.createElement('span'); name.textContent = title;
    const output = doc.createElement('output');
    const input = doc.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step;
    input.setAttribute('aria-label', `弹幕${title}`);
    input.addEventListener('input', () => { plugin.config({[key]: Number(input.value)}); sync(); });
    label.append(name, output, input); panel.append(label);
    inputs.push({input, output, key, format});
  }
  for (const [key, title] of [['antiOverlap', '防止重叠'], ['synchronousPlayback', '跟随播放倍速']]) {
    const label = doc.createElement('label');
    const name = doc.createElement('span'); name.textContent = title;
    const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(plugin.option[key]);
    input.addEventListener('change', () => plugin.config({[key]: input.checked}));
    label.append(name, input); panel.append(label);
  }
  for (const [mode, title] of [[0, '滚动弹幕'], [1, '顶部弹幕'], [2, '底部弹幕']]) {
    const label = doc.createElement('label');
    const name = doc.createElement('span'); name.textContent = title;
    const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = plugin.option.modes.includes(mode);
    input.addEventListener('change', () => plugin.config({modes: input.checked
      ? [...new Set([...plugin.option.modes, mode])] : plugin.option.modes.filter(value => value !== mode)}));
    label.append(name, input); panel.append(label);
  }
  const areaLabel = doc.createElement('label');
  const areaTitle = doc.createElement('span'); areaTitle.textContent = '显示区域';
  const area = doc.createElement('select');
  const margins = [[10, '75%'], [10, '50%'], [10, '25%'], [10, 10]];
  ['顶部四分之一', '顶部二分之一', '顶部四分之三', '全屏'].forEach((title, index) => {
    const option = doc.createElement('option'); option.value = index; option.textContent = title; area.append(option);
  });
  area.value = Math.max(0, margins.findIndex(value => JSON.stringify(value) === JSON.stringify(plugin.option.margin)));
  area.addEventListener('change', () => plugin.config({margin: margins[Number(area.value)]}));
  areaLabel.append(areaTitle, area); panel.append(areaLabel);
  const done = doc.createElement('button'); done.type = 'button'; done.textContent = '完成';
  done.addEventListener('click', () => {close(); settings.focus();}); panel.append(done);
  toggle.addEventListener('click', () => { plugin.config({visible: plugin.isHide}); sync(); });
  settings.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    settings.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { sync(); fit(); art.setting.show = false; art.controls.show = true; art.isInput = true; }
    else art.isInput = false;
  });
  toolbar.addEventListener('click', event => event.stopPropagation());
  toolbar.addEventListener('pointerdown', event => event.stopPropagation());
  toolbar.addEventListener('keydown', event => { if (event.key === 'Escape') {event.stopPropagation();close();settings.focus();} });
  toolbar.append(toggle, settings, panel);
  art.layers.add({name: 'mobile-danmaku', html: toolbar});
  const control = visible => {
    const fullscreen = player.classList.contains('fnos-mobile-fullscreen');
    toolbar.style.display = visible || !fullscreen ? '' : 'none';
    if (!visible && fullscreen) close();
  };
  const outside = event => {if (!toolbar.contains(event.target)) close();};
  art.proxy(player, 'click', outside);
  art.on('control', control);
  art.on('resize', fit);
  art.on('artplayerPluginDanmuku:config', sync);
  art.on('artplayerPluginDanmuku:show', sync);
  art.on('artplayerPluginDanmuku:hide', sync);
  sync(); fit();
  return () => {
    close();
    art.off('control', control); art.off('resize', fit);
    art.off('artplayerPluginDanmuku:config', sync);
    art.off('artplayerPluginDanmuku:show', sync); art.off('artplayerPluginDanmuku:hide', sync);
    toolbar.remove();
  };
}

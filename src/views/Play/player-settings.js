const categories = [
  {name: 'playback', html: '播放与选集', icon: 'bx-play-circle', items: ['媒体文件', '画质设置', '倍速设置', '音轨选择', '上一集设置', '下一集设置', '选集设置', '自动连播', '播完本集停止', '睡眠定时', '画中画']},
  {name: 'subtitles', html: '字幕', icon: 'bx-captions', items: ['字幕选择', '搜索字幕', '字幕大小', '字幕偏移', '字幕位置', '字幕描边', 'ASS特效字幕']},
  {name: 'danmaku', html: '弹幕与跳过', icon: 'bx-message-square-dots', items: ['搜索弹幕', '弹幕来源', '跳过片头片尾']},
  {name: 'preferences', html: '偏好与手势', icon: 'bx-slider-alt', items: ['触摸手势', '长按加速倍率', '首选字幕语言', '默认画质', '首选外部播放器', '恢复播放偏好']},
  {name: 'advanced', html: '画面与诊断', icon: 'bx-cog', items: ['是否开启302', '播放诊断']},
];
function copySetting(item) {
  const copy = Object.fromEntries(Object.getOwnPropertyNames(item).filter(key => !key.startsWith('$')).map(key => [key, item[key]]));
  if (item.selector) copy.selector = item.selector.map(copySetting);
  return copy;
}
export function playerSettingsGroups(options) {
  const entries = options.flatMap(item => item.name?.startsWith('fnos-settings-') ? item.selector : [item]).map(copySetting);
  const byName = new Map(entries.map(item => [item.name, item]));
  return categories.map(category => {
    const selector = category.items.flatMap(name => { const item = byName.get(name); byName.delete(name); return item ? [item] : []; });
    if (category.name === 'advanced') selector.push(...byName.values());
    return {name: 'fnos-settings-' + category.name, html: category.html, width: 380,
      icon: `<i class="bx ${category.icon}" aria-hidden="true"></i>`, tooltip: `${selector.length} 项`, selector};
  }).filter(group => group.selector.length);
}
export function groupPlayerSettings(player) {
  const setting = player.setting;
  const groups = playerSettingsGroups(setting.option);
  // Release events on child panels too; rebuilding must not retain old account callbacks.
  setting.traverse(item => setting.inactivate(item));
  for (const item of [...setting.option]) setting.remove(item.name);
  setting.cache.clear();
  setting.$parent.replaceChildren();
  for (const group of groups) setting.add(group);
  player.template.$player.classList.add('fnos-grouped-settings');
}

export function installPictureInPictureOverlays(player, doc = document) {
  const root = player.template.$player, video = player.video;
  const update = () => root.classList.toggle('fnos-pip-active', doc.pictureInPictureElement === video);
  video.addEventListener('enterpictureinpicture', update);
  video.addEventListener('leavepictureinpicture', update);
  update();
  const dispose = () => {
    video.removeEventListener('enterpictureinpicture', update);
    video.removeEventListener('leavepictureinpicture', update);
    root.classList.remove('fnos-pip-active');
  };
  player.on('destroy', dispose);
  return dispose;
}

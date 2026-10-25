export const EXTERNAL_PLAYER_IDS = Object.freeze(['iina', 'potplayer', 'nplayer', 'infuse', 'vlc', 'mxplayer', 'mxplayer-pro']);
const playerNames = {iina: 'IINA', potplayer: 'PotPlayer 播放列表', nplayer: 'nPlayer', infuse: 'Infuse',
  vlc: 'VLC', mxplayer: 'MX Player', 'mxplayer-pro': 'MX Player Pro'};
export function externalPlayerChoices(userAgent = '', maxTouchPoints = 0) {
  const ids = /Windows/i.test(userAgent) ? ['potplayer', 'vlc']
    : /Android/i.test(userAgent) ? ['vlc', 'nplayer', 'mxplayer', 'mxplayer-pro']
      : /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) ? ['infuse', 'nplayer', 'vlc']
        : /Macintosh|Mac OS/i.test(userAgent) ? ['iina', 'nplayer', 'vlc'] : ['vlc'];
  return [{value: '', label: '每次选择'}, ...ids.map(value => ({value, label: playerNames[value]}))];
}

export function externalPlayerLink(player, media, userAgent = '') {
  if (!media) return '';
  const url = new URL(media);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('不支持的媒体地址');
  const value = url.href;
  const intent = packageName => `intent://${value.slice(url.protocol.length + 2)}#Intent;scheme=${url.protocol.slice(0, -1)};action=android.intent.action.VIEW;type=video/*;package=${packageName};end`;
  switch (player) {
    case 'iina': return 'iina://weblink/?url=' + encodeURIComponent(value);
    case 'potplayer': throw new Error('请下载播放列表，或复制 HTTP 地址在 PotPlayer 中打开');
    case 'nplayer': return 'nplayer-' + value;
    case 'infuse': return 'infuse://x-callback-url/play?url=' + encodeURIComponent(value);
    case 'vlc': return /Android/i.test(userAgent) ? intent('org.videolan.vlc') : 'vlc://' + value;
    case 'mxplayer': return intent('com.mxtech.videoplayer.ad');
    case 'mxplayer-pro': return intent('com.mxtech.videoplayer.pro');
    default: throw new Error('未知播放器');
  }
}

export function externalPlaylist(media, title = '影片') {
  const url = new URL(media);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('不支持的媒体地址');
  const label = String(title).replace(/[\r\n\x00-\x1f]/g, ' ').trim() || '影片';
  return `#EXTM3U\n#EXTINF:-1,${label}\n${url.href}\n`;
}

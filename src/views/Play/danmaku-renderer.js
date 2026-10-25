// Remote text stays text. Only known image CDNs may contribute an image node.
const imageDomains = ['hdslb.com', 'bilibili.com', 'qpic.cn', 'gtimg.com', 'qq.com',
  'iqiyipic.com', 'iqiyi.com', 'youku.com', 'ykimg.com', 'alicdn.com', 'mgtv.com', 'hitv.com', 'sohu.com'];

export function emojiImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!imageDomains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null;
    return url.href;
  } catch { return null; }
}

export function renderDanmaku(node, emojis = {}, doc = node.ownerDocument) {
  const text = node.textContent || '';
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(/\[[^\]]+\]/g)) {
    const url = emojiImageUrl(Object.hasOwn(emojis, match[0]) ? emojis[match[0]] : null);
    if (!url) continue;
    fragment.append(doc.createTextNode(text.slice(cursor, match.index)));
    const image = doc.createElement('img');
    image.src = url;
    image.alt = match[0];
    image.referrerPolicy = 'no-referrer';
    image.style.cssText = 'height:1em;width:auto;vertical-align:middle';
    fragment.append(image);
    cursor = match.index + match[0].length;
  }
  fragment.append(doc.createTextNode(text.slice(cursor)));
  node.replaceChildren(fragment);
}

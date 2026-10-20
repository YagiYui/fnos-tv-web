export function playbackTitle(info = {}, category) {
  const title = String(info?.title ?? '');
  const number = info?.episode_number;
  const hasEpisode = number !== undefined && number !== null && number !== '' && Number.isFinite(Number(number));
  return category !== 'Movie' && hasEpisode ? `第${number}集${title ? '：' + title : ''}` : title;
}

export function continuePlaybackRoute(item) {
  const movie = item.type === 'Movie';
  return {path: '/player', query: {
    gallery_type: item.type,
    guid: movie ? item.guid : (item.parent_guid || item.guid),
    episode_guid: item.guid
  }};
}
export function playbackSelection(query) {
  return {
    guid: query.guid || null,
    category: query.gallery_type || null,
    episodeGuid: query.gallery_type === 'Movie' ? (query.guid || null) : (query.episode_guid || null)
  };
}

export function mediaDetailTitle(info = {}, category = '') {
  const valid = value => typeof value === 'string' && value.trim() ? value.trim() : '';
  const title = valid(info.title);
  const series = valid(info.tv_title);
  const name = valid(info.name);
  if (String(category).toLowerCase() === 'tv') return name || title || series;
  if (String(category).toLowerCase() === 'movie') return title || name || series;
  return [...new Set([series, title || name].filter(Boolean))].join(' ');
}

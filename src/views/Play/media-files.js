// Official stream relationships use media_guid. Never mix tracks from different files.
export function mediaFileStreams(streams, mediaGuid) {
  const files = streams?.files || [];
  const file = files.find(item => item.guid === mediaGuid);
  if (!file) throw new Error('所选媒体文件已不可用');
  const subset = key => (streams[key] || []).filter(track => track.media_guid === file.guid
    || (files.length === 1 && !track.media_guid));
  const result = {...streams, selected_media_guid: file.guid,
    video_streams: subset('video_streams'), audio_streams: subset('audio_streams'), subtitle_streams: subset('subtitle_streams')};
  if (!result.video_streams.length) throw new Error('所选文件没有可确认归属的视频流');
  return result;
}

export function mediaFileLabel(file, streams) {
  const video = (streams?.video_streams || []).find(row => row.media_guid === file.guid
    || (streams?.files?.length === 1 && !row.media_guid));
  const basename = String(file.path || file.name || '').split(/[\\/]/).pop() || '媒体文件';
  const spec = [video?.resolution_type || (video?.width && video?.height ? `${video.width}×${video.height}` : ''),
    video?.codec_name, Number(video?.bps) > 0 ? `${(video.bps / 1e6).toFixed(1)} Mbps` : ''].filter(Boolean);
  return `${basename}${spec.length ? ' · ' + spec.join(' / ') : ''}`;
}

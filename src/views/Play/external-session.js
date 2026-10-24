import {loadPlaybackMetadata, primaryMediaFile} from './playback-metadata.js';
import {chooseAudio} from './audio-tracks.js';
import {streamSubtitleGuid} from './subtitle.js';

// Default handoff owns a file capability; the explicit legacy HLS path owns a separate session.
export async function createExternalSession(requests, episode, {signal, position, mediaGuid, audioGuid, subtitleGuid, quality, maxAudioChannels = 2, preferFile = true} = {}) {
  if (preferFile) {
    const current = () => { if (signal?.aborted) throw Object.assign(new Error('外部播放已取消'), {name:'AbortError'}); };
    current();
    // A raw file needs no web playback session, transcoding quality or browser-decodable tracks.
    const streams = await requests('GET', '/api/v1/stream/list/' + episode + '?before_play=1', true, {}, {signal});
    current();
    if (!Array.isArray(streams?.files) || !streams.files.length) throw new Error('当前影片没有可用媒体文件');
    const file = mediaGuid ? streams.files.find(row => row?.guid === mediaGuid) : primaryMediaFile(streams);
    if (!file || typeof file.guid !== 'string' || !file.guid) throw new Error('所选媒体文件已不可用，请重新选择');
    return {item_guid:episode, media_guid:file.guid};
  }
  const metadata = await loadPlaybackMetadata(requests, episode, {signal, mediaGuid});
  const audio = chooseAudio(metadata.streams.audio_streams, audioGuid ?? metadata.info.item.audio_guid, '');
  const selected = metadata.qualities.find(item => item.resolution === quality?.resolution && Number(item.bitrate) === Number(quality?.bitrate)) || metadata.qualities[0];
  const subtitle = subtitleGuid === '' ? null : metadata.streams.subtitle_streams?.find(item => item.guid === (subtitleGuid ?? metadata.info.item.subtitle_guid));
  const video = metadata.streams.video_streams[0];
  const result = await requests('POST', '/api/v1/play/play', true, {
    media_guid: primaryMediaFile(metadata.streams).guid, video_guid: video.guid, video_encoder: video.codec_name,
    resolution: selected.resolution, bitrate: selected.bitrate,
    startTimestamp: Math.max(0, Math.floor(Number(position ?? metadata.info.item.watched_ts) || 0)),
    audio_encoder: 'aac', audio_guid: audio?.guid || '', subtitle_guid: streamSubtitleGuid(subtitle),
    channels: Number(audio?.channels) >= 6 && maxAudioChannels >= 6 ? 6 : 2,
  }, {signal});
  if (typeof result?.play_link !== 'string' || !result.play_link) throw new Error('外部播放会话准备失败');
  if (signal?.aborted) {
    void requests('POST', '/api/v1/media/p', true, {req: 'media.quit', reqid: '1234567890ABCDEF', playLink: result.play_link}).catch(() => {});
    throw Object.assign(new Error('外部播放已取消'), {name: 'AbortError'});
  }
  return {play_link: result.play_link};
}

import {mediaFileStreams} from './media-files.js';

export function primaryMediaFile(streams) {
  if (streams.selected_media_guid) return streams.files.find(file => file.guid === streams.selected_media_guid);
  return streams.files.find(file => !/\d+-\d+-\S+/.test(file.path)) || streams.files[0];
}

// Reads only. Start independent requests together; quality depends on the selected media file.
export async function loadPlaybackMetadata(requests, itemGuid, {signal, initialInfo = null, mediaGuid = null} = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  const current = () => {
    if (controller.signal.aborted) throw Object.assign(new Error('播放请求已取消'), {name: 'AbortError'});
  };
  const read = async (method, path, data = {}) => {
    current();
    const result = await requests(method, path, true, data, {signal: controller.signal});
    current();
    return result;
  };
  try {
    current();
    const [info, media] = await Promise.all([
      (async () => {
        const info = initialInfo || await read('POST', '/api/v1/play/info', {item_guid: itemGuid});
        if (!info?.item || info.item.guid !== itemGuid) throw new Error('播放信息与当前影片不匹配');
        return info;
      })(),
      (async () => {
        const streams = await read('GET', '/api/v1/stream/list/' + itemGuid + '?before_play=1');
        if (!Array.isArray(streams?.files) || !streams.files.length || !Array.isArray(streams.video_streams) || !streams.video_streams.length)
          throw new Error('当前影片没有可用视频流');
        const selected = mediaFileStreams(streams, mediaGuid || primaryMediaFile(streams).guid);
        const qualities = await read('POST', '/api/v1/play/quality', {media_guid: primaryMediaFile(selected).guid});
        if (!Array.isArray(qualities) || !qualities.length) throw new Error('当前影片没有可用画质');
        return {streams: selected, allStreams: streams, qualities};
      })()
    ]);
    current();
    return {info, ...media};
  } catch (error) {
    cancel(); // A failed branch must not leave its sibling request running.
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

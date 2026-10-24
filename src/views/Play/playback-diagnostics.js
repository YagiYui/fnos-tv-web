// Construct an allowlist, never sanitize/stringify whole API/engine/error objects.
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
const word = value => typeof value === 'string' && /^[a-zA-Z0-9_. -]{1,40}$/.test(value) ? value : null;
export function playbackDiagnostics({video, engine, videoTrack, audioTrack, quality, subtitleMode, failure, use302 = false} = {}) {
  let ahead = 0;
  const time = number(video?.currentTime);
  try {
    for (let i = 0; i < (video?.buffered?.length || 0); i++)
      if (video.buffered.start(i) <= time && time <= video.buffered.end(i)) ahead = video.buffered.end(i) - time;
  } catch { /* Detached media elements may no longer have readable ranges. */ }
  const levels = engine?.levels, level = levels?.[engine?.currentLevel];
  return {
    schema: 1, transport: use302 ? 'direct-address' : Array.isArray(levels) ? 'hls' : engine ? 'media-engine' : 'browser',
    processing: 'unknown', // Encoding metadata alone cannot prove server-side transcoding.
    positionSeconds: time, durationSeconds: number(video?.duration), paused: Boolean(video?.paused),
    readyState: number(video?.readyState), networkState: number(video?.networkState), bufferedAheadSeconds: number(ahead),
    sourceVideoCodec: word(videoTrack?.codec_name), sourceAudioCodec: word(audioTrack?.codec_name),
    selectedResolution: word(quality?.resolution), requestedBitrate: number(Number(quality?.bitrate)),
    observedVideoCodec: word(level?.videoCodec), observedAudioCodec: word(level?.audioCodec), observedBitrate: number(level?.bitrate),
    subtitleMode: ['text','ass','pgs'].includes(subtitleMode) ? subtitleMode : 'unknown',
    mediaErrorCode: number(video?.error?.code), recoveryRequired: Boolean(failure),
    recoveryReason: !failure ? null : /授权|登录/.test(failure.message || '') ? 'authorization'
      : /超时/.test(failure.message || '') ? 'timeout' : /解码/.test(failure.message || '') ? 'decode'
        : /连接|服务/.test(failure.message || '') ? 'network-or-service' : 'unavailable',
  };
}

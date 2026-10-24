import assert from 'node:assert/strict';
import {mediaFileStreams, mediaFileLabel} from './src/views/Play/media-files.js';
import {loadPlaybackMetadata, primaryMediaFile} from './src/views/Play/playback-metadata.js';
import {createExternalSession} from './src/views/Play/external-session.js';
import {localSubtitleVtt, shiftVtt} from './src/views/Play/subtitle-adjustments.js';
import {SubtitleOverlay} from './src/views/Play/ass-renderer.js';
import {playbackDiagnostics} from './src/views/Play/playback-diagnostics.js';
const all = {files: [{guid: 'a', path: '/library/first.mkv'}, {guid: 'b', path: '/library/second.mkv'}],
  video_streams: [{guid: 'v-a', media_guid: 'a', codec_name: 'h264'}, {guid: 'v-b', media_guid: 'b', codec_name: 'hevc', width: 3840, height: 2160, bps: 8e6}],
  audio_streams: [{guid: 'a-a', media_guid: 'a'}, {guid: 'a-b', media_guid: 'b'}, {guid: 'orphan'}],
  subtitle_streams: [{guid: 's-a', media_guid: 'a'}, {guid: 's-b', media_guid: 'b'}]};
const selected = mediaFileStreams(all, 'b');
assert.equal(selected.video_streams[0].guid, 'v-b'); assert.equal(selected.audio_streams[0].guid, 'a-b');
assert.deepEqual(selected.subtitle_streams.map(row => row.guid), ['s-b']); assert.equal(selected.audio_streams.length, 1);
assert.equal(primaryMediaFile(selected).guid, 'b'); assert.equal(all.selected_media_guid, undefined);
assert.throws(() => mediaFileStreams(all, 'missing'), /不可用/);
assert.throws(() => mediaFileStreams({...all, video_streams: [{guid: 'orphan'}]}, 'b'), /归属/);
assert.equal(mediaFileStreams({files: [{guid: 'only'}], video_streams: [{guid: 'v'}]}, 'only').video_streams.length, 1);
assert.match(mediaFileLabel(all.files[1], all), /^second.mkv · 3840×2160 \/ hevc \/ 8.0 Mbps$/);
assert.ok(!mediaFileLabel(all.files[1], all).includes('/library'));
const calls = [], quality = {resolution: '1080', bitrate: 4e6};
const requests = async (method, path, _, data) => {
  calls.push({method, path, data});
  if (path.includes('stream/list')) return all;
  if (path.includes('play/info')) return {item: {guid: 'episode', subtitle_guid: 's-a'}};
  if (path.includes('play/quality')) return [quality];
  if (path.includes('play/play')) return {play_link: '/synthetic-session'};
};
const metadata = await loadPlaybackMetadata(requests, 'episode', {mediaGuid: 'b'});
assert.equal(calls.find(row => row.path.includes('play/quality')).data.media_guid, 'b');
assert.equal(metadata.allStreams, all); assert.equal(metadata.streams.video_streams[0].guid, 'v-b');
await createExternalSession(requests, 'episode', {mediaGuid: 'b', subtitleGuid: 's-b', preferFile: true});
assert.equal(calls.some(row => row.path.includes('play/play')), false);
await createExternalSession(requests, 'episode', {mediaGuid: 'b', subtitleGuid: 's-b'});
assert.equal(calls.at(-1).data.media_guid, 'b'); assert.equal(calls.at(-1).data.video_guid, 'v-b');
assert.equal(calls.at(-1).data.audio_guid, 'a-b'); assert.equal(calls.at(-1).data.subtitle_guid, 's-b');
const local = localSubtitleVtt('1\r\n00:00:01,000 --> 00:00:03,000\r\n<b>文字</b><img src="https://example.invalid/track">\r\n', 'sample.srt');
assert.equal(local, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n文字\n');
assert.match(shiftVtt(local, 1.5), /00:00:02.500 --> 00:00:04.500/);
assert.match(shiftVtt(local, -1.5), /00:00:00.000 --> 00:00:01.500/);
assert.equal(shiftVtt(local, NaN), local);
assert.throws(() => localSubtitleVtt('bad', 'sample.ass'), /SRT/);
assert.throws(() => localSubtitleVtt('1\n00:00:01,000 --> 00:00:00,000\nx', 'bad.srt'), /结束/);
assert.throws(() => localSubtitleVtt('1\n00:65:01,000 --> 00:66:03,000\nx', 'bad.srt'), /时间/);
assert.throws(() => localSubtitleVtt('�', 'bad.srt'), /UTF-8/);
assert.throws(() => localSubtitleVtt('x'.repeat(2 * 1024 * 1024 + 1), 'big.vtt'), /2 MB/);
assert.ok(!localSubtitleVtt('WEBVTT\n\nSTYLE\n::cue {color:red}\n\n00:01.000 --> 00:03.000\nx', 'sample.vtt').includes('STYLE'));
for (const kind of ['ass', 'pgs']) {
  let options, instance;
  class Renderer {
    constructor(value) { options = value; this.video = value.video; instance = this; queueMicrotask(() => (value.onLoaded || value.onReady)()); }
    setCurrentTime(value) { this.time = value; }
    dispose() { this.disposed = true; }
  }
  const overlay = new SubtitleOverlay({kind, load: async () => Renderer});
  overlay.setOffset(2); await overlay.show({currentTime: 10}, 'synthetic'); assert.equal(options.timeOffset, -2);
  overlay.setOffset(-1); assert.equal(instance.timeOffset, 1); if (kind === 'ass') assert.equal(instance.time, 11);
  overlay.clear(); assert.equal(instance.disposed, true);
}
const secret = 'https://example.invalid/private?token=PRIVATE';
const report = playbackDiagnostics({video: {currentTime: 12, duration: 30, src: secret, error: {code: 2, message: secret},
  buffered: {length: 1, start: () => 10, end: () => 20}}, videoTrack: {...all.video_streams[1], path: secret},
  audioTrack: {codec_name: 'aac'}, quality: {resolution: '1080', bitrate: 4e6, url: secret}, failure: {message: secret},
  engine: {levels: [{videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2', bitrate: 3e6, url: secret}], currentLevel: 0}});
assert.equal(report.bufferedAheadSeconds, 8); assert.equal(report.processing, 'unknown');
assert.equal(report.observedVideoCodec, 'avc1.640028'); assert.equal(report.mediaErrorCode, 2);
assert.ok(!JSON.stringify(report).includes('PRIVATE')); assert.ok(!JSON.stringify(report).includes('https'));
assert.equal(playbackDiagnostics({video: {duration: Infinity}}).durationSeconds, null);
console.log('PASS: file/track/quality/external ownership, local subtitle limits/plain text, delay direction, ASS/PGS time offset and diagnostic allowlist');

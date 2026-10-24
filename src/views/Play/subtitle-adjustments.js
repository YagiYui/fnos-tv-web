export const MAX_LOCAL_SUBTITLE_BYTES = 2 * 1024 * 1024;
const timing = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/;
function seconds(value) {
  const match = timing.exec(value);
  if (!match || +match[2] > 59 || +match[3] > 59) throw new Error('字幕时间格式无效');
  return (+match[1] || 0) * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
}
function timestamp(value) {
  const ms = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function shiftVtt(text, offset) {
  const delay = Number.isFinite(offset) ? Math.min(60, Math.max(-60, offset)) : 0;
  return text.replace(/^(\d{2,3}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2,3}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})(.*)$/gm,
    (_, start, end, settings) => `${timestamp(seconds(start) + delay)} --> ${timestamp(seconds(end) + delay)}${settings}`);
}
export function localSubtitleVtt(text, filename) {
  if (!/\.(srt|vtt)$/i.test(filename)) throw new Error('本地导入支持 UTF-8 的 SRT／VTT 字幕');
  if (new TextEncoder().encode(text).length > MAX_LOCAL_SUBTITLE_BYTES) throw new Error('字幕文件超过 2 MB');
  const content = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (content.includes('\uFFFD') || content.includes('\0')) throw new Error('请先将字幕转为 UTF-8 编码');
  const blocks = content.split(/\n\s*\n/), cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex(line => line.includes('-->'));
    if (i < 0) continue;
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[i].trim());
    if (!match) throw new Error('字幕时间格式无效');
    const start = seconds(match[1]), end = seconds(match[2]);
    if (end <= start) throw new Error('字幕结束时间必须晚于开始时间');
    // Local files cannot inject HTML, external images, STYLE or REGION blocks.
    const payload = lines.slice(i + 1).join('\n').replace(/<[^>]*>/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (payload.trim()) cues.push(`${timestamp(start)} --> ${timestamp(end)}\n${payload}`);
    if (cues.length > 50000) throw new Error('字幕条数超过上限');
  }
  if (!cues.length) throw new Error('未找到有效字幕条目');
  return 'WEBVTT\n\n' + cues.join('\n\n') + '\n';
}

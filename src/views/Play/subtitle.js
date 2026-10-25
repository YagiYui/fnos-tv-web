export function subtitleSegmentUrl(uri, playlistUrl) {
    const base = new URL(playlistUrl, 'http://localhost');
    const target = new URL(uri.trim(), base);
    // 上游有时输出 /v/media/... 或绝对 NAS 地址，统一经过当前站点代理。
    if (target.pathname.startsWith('/v/media/')) {
        return new URL('/fnos' + target.pathname + target.search, base.origin).href;
    }
    if (target.origin !== base.origin) throw new Error('字幕分段指向非预期地址');
    return target.href;
}

export function parseSubtitlePlaylist(text, playlistUrl) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim());
    if (lines[0] !== '#EXTM3U') throw new Error('字幕接口未返回有效播放列表，请重新登录或切换字幕');
    let start = 0;
    let duration = 6;
    const result = [];
    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const value = Number.parseFloat(line.slice(8));
            if (Number.isFinite(value) && value > 0) duration = value;
        } else if (line && !line.startsWith('#')) {
            result.push({url: subtitleSegmentUrl(line, playlistUrl), start, end: start + duration});
            start += duration;
        }
    }
    return result;
}

export function subtitlePayload(text) {
    if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(text)) throw new Error('字幕分段不是 WebVTT 格式');
    const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
    return blocks.slice(1).join('\n\n').trim();
}

export class SegmentedSubtitleLoader {
    constructor({fetchText, render, clear, getTime}) {
        this.fetchText = fetchText;
        this.render = render;
        this.onClear = clear;
        this.getTime = getTime;
        this.generation = 0;
        this.segments = [];
        this.cache = new Map();
        this.pending = new Map();
        this.rendered = '';
        this.latestIndex = -1;
    }

    clear() {
        this.generation++;
        this.segments = [];
        this.cache.clear();
        this.pending.clear();
        this.rendered = '';
        this.latestIndex = -1;
        this.onClear();
    }

    async setPlaylist(url) {
        this.clear();
        const generation = this.generation;
        let text;
        try { text = await this.fetchText(url); }
        catch (error) { if (generation !== this.generation) return; throw error; }
        if (generation !== this.generation) return;
        this.segments = parseSubtitlePlaylist(text, url);
        await this.update(this.getTime());
    }

    async update(time) {
        if (!this.segments.length) return;
        let index = this.segments.findIndex(s => time >= s.start && time < s.end);
        if (index < 0) index = time < this.segments[0].start ? 0 : this.segments.length - 1;
        this.latestIndex = index;
        const generation = this.generation;
        const key = `${generation}:${index}`;
        if (key === this.rendered) return;
        const indices = [index - 1, index, index + 1].filter(i => i >= 0 && i < this.segments.length);
        const results = await Promise.allSettled(indices.map(async i => {
            if (this.cache.has(i)) return;
            if (!this.pending.has(i)) {
                const segment = this.segments[i];
                const job = this.fetchText(segment.url).then(text => {
                    if (generation === this.generation) this.cache.set(i, subtitlePayload(text));
                }).finally(() => {
                    if (generation === this.generation) this.pending.delete(i);
                });
                this.pending.set(i, job);
            }
            await this.pending.get(i);
        }));
        if (generation !== this.generation || index !== this.latestIndex || key === this.rendered) return;
        // 预读相邻分段失败时，仍显示已经取得的当前分段。
        if (!this.cache.has(index)) throw results[indices.indexOf(index)].reason || new Error('当前字幕分段不可用');
        const content = indices.map(i => this.cache.get(i) || '').filter(Boolean).join('\n\n');
        await this.render('WEBVTT\n\n' + content + '\n');
        if (generation !== this.generation) return;
        this.rendered = key;
        for (const i of this.cache.keys()) if (Math.abs(i - index) > 2) this.cache.delete(i);
    }
}

export function createBlobVTTUrl(text) {
    return URL.createObjectURL(new Blob([text], {type: 'text/vtt'}));
}

export function subtitleOptions(streams, currentGuid) {
    const unique = [...new Map((streams || []).filter(s => s.guid).map(s => [s.guid, s])).values()];
    return [{html: '关闭字幕', guid: null, index: -1, default: !currentGuid}, ...unique.map(sub => ({
        ...sub,
        html: [sub.title || '字幕', sub.language, (sub.codec_name || sub.format || '').toUpperCase()].filter(Boolean).join(' · '),
        guid: sub.guid, index: sub.index, default: sub.guid === currentGuid
    }))];
}

export function subtitleSearchResults(data, streams = []) {
    if (!Array.isArray(data?.subtitles)) throw new Error('字幕搜索返回格式异常');
    return data.subtitles.map((sub, index) => ({
        ...sub, trimId: sub.trim_id || sub.trimId || '',
        key: `${sub.trim_id || sub.trimId || sub.source_id || index}:${index}`,
        filename: sub.filename || sub.name || '未命名字幕',
        format: String(sub.format || '').toUpperCase(),
        existingGuid: streams.find(s => (s.trim_id || s.trimId) === (sub.trim_id || sub.trimId) && (sub.trim_id || sub.trimId))?.guid
    }));
}

export async function downloadSubtitle(request, mediaGuid, result) {
    if (!mediaGuid || !result.trimId) throw new Error('字幕结果缺少下载标识，请重新搜索');
    const stream = await request('POST', '/api/v1/subtitle/download', true, {
        media_guid: mediaGuid, trim_id: result.trimId, sync_download: 1
    });
    if (!stream?.guid) throw new Error('字幕下载未返回轨道，请刷新字幕列表后重试');
    return stream;
}

export function bindSubtitleTrack(player) {
    // HLS 可能插入其他 textTrack；Artplayer 默认读取第 0 条，会读到空轨道。
    Object.defineProperty(player.subtitle, 'textTrack', {
        configurable: true,
        get: () => player.template.$track?.track
    });
}

export function isPgsSubtitle(track) {
    return ['hdmv_pgs_subtitle', 'pgssub', 'pgs'].includes(String(track?.codec_name || track?.format || '').toLowerCase());
}
export function streamSubtitleGuid(track) {
    return isPgsSubtitle(track) ? '' : (track?.guid || '');
}

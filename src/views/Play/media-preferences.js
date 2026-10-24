export const QUALITY_PREFERENCES = Object.freeze([
  {value: 'highest', label: '最高可用'}, {value: '4k', label: '4K'},
  {value: '1080', label: '1080P'}, {value: '720', label: '720P'},
  {value: '480', label: '480P'}, {value: '360', label: '360P'},
]);
export const validSubtitleLanguage = value => typeof value === 'string'
  && (value === '' || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(value));
export const escapePreferenceLabel = value => String(value).replace(/[&<>"']/g,
  char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const language = value => String(value || '').trim().toLowerCase().replaceAll('_', '-');
function languageFamily(value) {
  const code = language(value).split('-')[0];
  return ({chi: 'zh', zho: 'zh', eng: 'en', jpn: 'ja', kor: 'ko', fra: 'fr', fre: 'fr',
    deu: 'de', ger: 'de', spa: 'es', rus: 'ru', ita: 'it', por: 'pt'})[code] || code;
}
export function subtitleLanguageChoices(tracks, preferred = '') {
  const codes = [...new Set((Array.isArray(tracks) ? tracks : []).map(row => row.language)
    .filter(value => validSubtitleLanguage(value) && value && value !== 'off'))];
  if (preferred && preferred !== 'off' && validSubtitleLanguage(preferred) && !codes.includes(preferred)) codes.push(preferred);
  return [{value: '', label: '跟随影片'}, {value: 'off', label: '默认关闭字幕'},
    ...codes.map(value => ({value, label: subtitleLanguageLabel(value)}))];
}
export function subtitleLanguageLabel(value) {
  if (!value) return '跟随影片';
  if (value === 'off') return '默认关闭字幕';
  const name = {zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语'}[languageFamily(value)];
  return escapePreferenceLabel(name ? `${name} · ${value}` : value);
}
export function choosePreferredSubtitle(tracks, savedGuid, preferred, overrideGuid) {
  const rows = Array.isArray(tracks) ? tracks : [];
  if (overrideGuid === '') return null;
  const explicit = overrideGuid == null ? null : rows.find(row => row.guid === overrideGuid);
  if (explicit) return explicit;
  if (preferred === 'off') return null;
  return (preferred && rows.find(row => language(row.language) === language(preferred)))
    || (preferred && rows.find(row => row.language && languageFamily(row.language) === languageFamily(preferred)))
    || rows.find(row => row.guid === savedGuid) || rows.find(row => Number(row.is_default) === 1) || rows[0] || null;
}
function resolutionHeight(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === '4k') return 2160;
  if (text === '8k') return 4320;
  return /^\d{3,4}p?$/.test(text) ? Number(text.replace('p', '')) : 0;
}
export function qualityPreferenceFallback(selected, preference) {
  return preference !== 'highest' && QUALITY_PREFERENCES.some(item => item.value === preference)
    && resolutionHeight(selected?.resolution) !== resolutionHeight(preference);
}
export function choosePreferredQuality(qualities, preference = 'highest', fallback = null) {
  const rows = (Array.isArray(qualities) ? qualities : []).filter(row => typeof row.resolution === 'string'
    && row.resolution.trim() && ['number', 'string'].includes(typeof row.bitrate)
    && Number.isFinite(Number(row.bitrate)) && Number(row.bitrate) > 0);
  const original = rows.find(row => row.resolution === fallback?.resolution && Number(row.bitrate) === Number(fallback?.bitrate)) || rows[0] || null;
  if (preference === 'highest' || !QUALITY_PREFERENCES.some(item => item.value === preference)) return original;
  const ranked = rows.filter(row => resolutionHeight(row.resolution) > 0)
    .sort((a, b) => resolutionHeight(b.resolution) - resolutionHeight(a.resolution) || Number(b.bitrate) - Number(a.bitrate));
  const below = ranked.find(row => resolutionHeight(row.resolution) <= resolutionHeight(preference));
  if (below) return below;
  const lowest = ranked.at(-1);
  return lowest ? ranked.find(row => resolutionHeight(row.resolution) === resolutionHeight(lowest.resolution)) : original;
}

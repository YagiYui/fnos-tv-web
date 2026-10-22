export function chooseAudio(tracks, savedGuid, preferredLanguage) {
  const rows = Array.isArray(tracks) ? tracks : [];
  return (preferredLanguage && rows.find(track => track.language === preferredLanguage))
    || rows.find(track => track.guid === savedGuid)
    || rows.find(track => Number(track.is_default) === 1) || rows[0] || null;
}

export function audioLabel(track) {
  if (!track) return '无音轨';
  const text = [track.language || '未知语言', track.title, track.codec_name?.toUpperCase(),
    track.channel_layout || (track.channels ? `${track.channels} 声道` : ''),
    Number(track.is_default) === 1 ? '默认' : ''].filter(Boolean).join(' · ');
  // ArtPlayer settings interpret their labels as HTML.
  return text.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function readPlayerPreference(storage, account, key, fallback) {
  try { return JSON.parse(storage.getItem(`fnosPlayer:${account || 'local'}:${key}`)) ?? fallback; }
  catch { return fallback; }
}

export function writePlayerPreference(storage, account, key, value) {
  try { storage.setItem(`fnosPlayer:${account || 'local'}:${key}`, JSON.stringify(value)); } catch {}
}

export function createAutoplayCountdown(onTick, advance, schedule = setTimeout, unschedule = clearTimeout) {
  let timer = null, generation = 0;
  const cancel = () => { generation++; if (timer !== null) unschedule(timer); timer = null; onTick(null); };
  return {cancel, start(seconds = 5) {
    cancel();
    const current = generation;
    const tick = remaining => {
      if (current !== generation) return;
      if (remaining <= 0) { timer = null; onTick(null); void advance(); return; }
      onTick(remaining);
      timer = schedule(() => tick(remaining - 1), 1000);
    };
    tick(seconds);
  }};
}

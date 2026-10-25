import assert from 'node:assert/strict';
import {installMobileGestures} from './src/views/Play/player-interactions.js';
import {normalizeGestureSettings} from './src/views/Play/gesture-settings.js';

function target() {
  const listeners = new Map();
  return {listeners, addEventListener(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn);
  }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  fire(type, payload = {}) {
    const event = {type, prevented: false, stopped: false, preventDefault() {this.prevented = true;},
      stopImmediatePropagation() {this.stopped = true;}, ...payload};
    for (const fn of listeners.get(type) || []) fn(event); return event;
  }, count() {return [...listeners.values()].reduce((sum, rows) => sum + rows.size, 0);}};
}
function fixture({enabled = true, holdRate = 2, rate = 1.5, touch = true, rotated = false} = {}) {
  const player = target(), win = target(), doc = target(), timers = new Map();
  let now = 0, sequence = 0, children = 0;
  Object.assign(player, {classList: {contains: () => touch}, append: () => children++,
    getBoundingClientRect: () => ({left: 0, top: 0, right: rotated ? 450 : 800, width: rotated ? 450 : 800, height: rotated ? 800 : 450})});
  doc.createElement = () => ({setAttribute() {}, hidden: true, remove() {children--;}});
  win.setTimeout = (fn, ms) => {timers.set(++sequence, {fn, at: now + ms}); return sequence;};
  win.clearTimeout = id => timers.delete(id);
  const tick = ms => {
    const until = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = until;
  };
  const video = {style: {filter: 'contrast(1.1)'}}, engineEvents = target();
  const art = {template: {$player: player, $video: video}, fullscreen: true, fullscreenWeb: false,
    isRotate: rotated, playbackRate: rate, playing: true, volume: 0.5, muted: true,
    currentTime: 12, duration: 1800, on: (name, fn) => engineEvents.addEventListener(name, fn),
    off: (name, fn) => engineEvents.removeEventListener(name, fn)};
  const preferences = {enabled, holdRate};
  const dispose = installMobileGestures(art, win, doc, {getPreferences: () => preferences});
  const fire = (type, x = 300, y = 180, extra = {}) => player.fire(type, {
    target: {closest: () => false}, touches: [{identifier: 1, clientX: x, clientY: y}], ...extra});
  return {art, player, video, win, doc, engineEvents, tick, fire, timers, preferences, dispose,
    get children() {return children;}};
}

assert.deepEqual(normalizeGestureSettings(null), {enabled: true, holdRate: 2});
assert.deepEqual(normalizeGestureSettings({enabled: false, holdRate: 2.5}), {enabled: false, holdRate: 2.5});
assert.deepEqual(normalizeGestureSettings({enabled: 'false', holdRate: '3'}), {enabled: true, holdRate: 2});
for (const holdRate of [2, 2.5, 3]) {
  const f = fixture({holdRate}); f.fire('touchstart'); f.tick(449);
  assert.equal(f.art.playbackRate, 1.5); f.tick(1);
  assert.equal(f.art.playbackRate, holdRate); assert.equal(f.art.fnosTemporarySpeed, true);
  f.fire('touchend'); assert.equal(f.art.playbackRate, 1.5); assert.equal(f.art.fnosTemporarySpeed, false);
  f.dispose(); f.dispose(); assert.equal(f.timers.size, 0); assert.equal(f.children, 0);
  assert.equal(f.player.count() + f.win.count() + f.doc.count() + f.engineEvents.count(), 0);
}
const fast = fixture({rate: 3, holdRate: 2}); fast.fire('touchstart'); fast.tick(450);
assert.equal(fast.art.playbackRate, 3, 'A hold never slows an already faster session'); fast.dispose();

for (const stop of [f => f.win.fire('blur'), f => f.doc.fire('visibilitychange'),
  f => f.win.fire('resize'), f => f.win.fire('orientationchange'),
  f => f.engineEvents.fire('video:pause'), f => f.engineEvents.fire('video:ended'),
  f => f.engineEvents.fire('video:loadstart'), f => f.fire('touchcancel'),
  f => f.fire('touchmove', 300, 180, {touches: [{identifier: 1}, {identifier: 2}]}),
  f => {f.art.fullscreen = false; f.engineEvents.fire('fullscreen');}, f => f.dispose()]) {
  const f = fixture({holdRate: 3}); f.fire('touchstart'); f.tick(450); stop(f);
  assert.equal(f.art.playbackRate, 1.5); assert.equal(f.art.fnosTemporarySpeed, false); f.dispose();
}
for (const prepare of [f => {f.art.fullscreen = false;}, f => {f.art.isLock = true;},
  f => {f.preferences.enabled = false;}]) {
  const f = fixture(); prepare(f); const e = f.fire('touchstart'); f.tick(450);
  assert.equal(e.prevented, false); assert.equal(f.art.playbackRate, 1.5); f.dispose();
}
const controls = fixture(); controls.fire('touchstart', 300, 180, {target: {closest: () => true}});
controls.tick(450); assert.equal(controls.art.playbackRate, 1.5); controls.dispose();
const edge = fixture(); edge.fire('touchstart', 10, 180); edge.tick(450);
assert.equal(edge.art.playbackRate, 1.5); edge.dispose();

const disabled = fixture(); disabled.fire('touchstart'); disabled.tick(450);
disabled.preferences.enabled = false; disabled.dispose.refresh();
assert.equal(disabled.art.playbackRate, 1.5); disabled.tick(1000);
assert.equal(disabled.fire('touchmove', 400).prevented, false); disabled.dispose();
const pending = fixture(); pending.fire('touchstart'); pending.preferences.enabled = false; pending.tick(450);
assert.equal(pending.art.playbackRate, 1.5, 'Timer rechecks enabled state even before an explicit refresh'); pending.dispose();
const changed = fixture(); changed.fire('touchstart'); changed.tick(450);
changed.preferences.holdRate = 3; changed.dispose.refresh(); assert.equal(changed.art.playbackRate, 1.5);
changed.fire('touchstart'); changed.tick(450); assert.equal(changed.art.playbackRate, 3); changed.dispose();

const seek = fixture(); seek.fire('touchstart'); const moved = seek.fire('touchmove', 400, 180);
assert.equal(moved.prevented, true); assert.equal(seek.art.currentTime, 12); seek.fire('touchend');
assert.equal(seek.art.seek, 27); seek.dispose();
const cancelSeek = fixture(); cancelSeek.fire('touchstart'); cancelSeek.fire('touchmove', 400, 180);
cancelSeek.preferences.enabled = false; cancelSeek.dispose.refresh(); cancelSeek.fire('touchend');
assert.equal(cancelSeek.art.seek, undefined, 'Disabling does not commit a pending seek'); cancelSeek.dispose();
const bright = fixture(); bright.fire('touchstart', 180, 180); bright.fire('touchmove', 180, 280);
assert.match(bright.video.style.filter, /brightness\(0\./);
bright.preferences.enabled = false; bright.dispose.refresh(); assert.equal(bright.video.style.filter, 'contrast(1.1)'); bright.dispose();
const volume = fixture(); volume.fire('touchstart', 650, 180); volume.fire('touchmove', 650, 100);
assert.ok(volume.art.volume > 0.5); assert.equal(volume.art.muted, false); volume.dispose();
const rotated = fixture({rotated: true}); rotated.fire('touchstart', 270, 180); rotated.fire('touchmove', 170, 180);
assert.match(rotated.video.style.filter, /brightness\(0\./); rotated.dispose();
const desktop = fixture({touch: false}); assert.equal(desktop.children, 0); assert.equal(desktop.player.count(), 0); desktop.dispose();
console.log('PASS: configurable fullscreen gestures, hold rates, disable/refresh/cancel, seek, brightness, volume, rotation and idempotent cleanup');

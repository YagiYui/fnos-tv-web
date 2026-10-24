import assert from 'node:assert/strict';
import {createPlayerPreferenceStore, PLAYER_PREFERENCE_DEFAULTS} from './src/views/Play/player-preferences.js';

const values = new Map();
const storage = {getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
const store = createPlayerPreferenceStore(() => storage);
const pending = store.bindAccount(null);
assert.deepEqual(pending.write('autoPlayNext', false), {accepted: false, persisted: false});
assert.equal(values.size, 0);

// Existing account-scoped audio/auto-play keys are compatible. Global keys have no owner.
values.set('fnosPlayer:alice:audioLanguage', '"zho"');
values.set('fnosPlayer:alice:autoPlayNext', 'false');
values.set('playbackRate', '2');
values.set('fnosAssSubtitles', 'false');
const alice = store.bindAccount('alice');
assert.equal(alice.read('audioLanguage'), 'zho');
assert.equal(alice.read('autoPlayNext'), false);
assert.equal(alice.read('playbackRate'), 1);
assert.equal(alice.read('assSubtitles'), true);
assert.deepEqual(alice.write('playbackRate', 1.5), {accepted: true, persisted: true});
const bob = store.bindAccount('bob');
assert.equal(bob.read('audioLanguage'), '');
assert.equal(bob.read('playbackRate'), 1);
assert.equal(alice.write('audioLanguage', 'eng').accepted, false);
const aliceAgain = store.bindAccount('alice');
assert.equal(aliceAgain.read('playbackRate'), 1.5);
assert.equal(alice.write('autoPlayNext', true).accepted, false);
assert.equal(alice.reset().accepted, false);
assert.equal(aliceAgain.read('autoPlayNext'), false);
store.clearAccount();
assert.equal(aliceAgain.write('playbackRate', 2).accepted, false);

// Malformed storage and wrong types must not silently enable settings or break playback.
for (const [name, bad] of [ ['autoPlayNext', 'false'], ['assSubtitles', 0], ['use302', {}],
  ['audioLanguage', '<bad\nvalue>'], ['audioLanguage', 'x'.repeat(65)],
  ['subtitleFontSize', 11], ['subtitleFontSize', 61], ['subtitleFontSize', 20.5],
  ['playbackRate', 0], ['playbackRate', 4], ['playbackRate', '1.5'], ['audioLanguage', ['eng']] ]) {
  values.set(`fnosPlayer:broken:${name}`, JSON.stringify(bad));
  const handle = store.bindAccount('broken');
  assert.equal(handle.read(name), PLAYER_PREFERENCE_DEFAULTS[name]);
  assert.equal(handle.write(name, bad).accepted, false);
}
values.set('fnosPlayer:broken:autoPlayNext', '{broken');
assert.equal(store.bindAccount('broken').read('autoPlayNext'), true);
assert.throws(() => store.bindAccount('alice').write('__proto__', {}), TypeError);
for (const rate of [NaN, Infinity, -Infinity]) {
  assert.equal(store.bindAccount('alice').write('playbackRate', rate).accepted, false);
}

// Reset is scoped and reports partial persistence failures without removing unrelated data.
values.set('fnosPlayer:bob:playbackRate', '2');
values.set('fnosPlayer:alice:futureSetting', 'preserve');
values.set('searchHistory', 'preserve');
const reset = store.bindAccount('alice');
assert.equal(reset.reset().persisted, true);
for (const [name, fallback] of Object.entries(PLAYER_PREFERENCE_DEFAULTS)) assert.equal(reset.read(name), fallback);
assert.equal(values.get('fnosPlayer:bob:playbackRate'), '2');
assert.equal(values.get('fnosPlayer:alice:futureSetting'), 'preserve');
assert.equal(values.get('searchHistory'), 'preserve');
assert.equal(values.get('playbackRate'), '2');

const blocked = createPlayerPreferenceStore(() => { throw new Error('SecurityError'); }).bindAccount('alice');
assert.equal(blocked.read('subtitleFontSize'), 20);
assert.deepEqual(blocked.write('subtitleFontSize', 28), {accepted: true, persisted: false});
assert.equal(blocked.read('subtitleFontSize'), 28);
assert.deepEqual(blocked.reset(), {accepted: true, persisted: false});
assert.equal(blocked.read('subtitleFontSize'), 20);
let removed = 0;
const partial = createPlayerPreferenceStore(() => ({...storage, removeItem(key) {
  if (++removed === 1) throw new Error('QuotaError'); storage.removeItem(key);
}})).bindAccount('alice');
assert.equal(partial.reset().persisted, false);
assert.equal(removed, Object.keys(PLAYER_PREFERENCE_DEFAULTS).length);
console.log('PASS: preference types, account lifecycle, compatibility, scoped reset and unavailable storage');

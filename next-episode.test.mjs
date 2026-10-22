import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nextEpisode} from './src/views/Play/player-presentation.js';
const episodes = [{guid: 'one', episode_number: '1'}, {guid: 'two', episode_number: '2'}];
assert.equal(nextEpisode(episodes, {episode_number: '1'}, 'TV').guid, 'two');
assert.equal(nextEpisode(episodes, {episode_number: 2}, 'TV'), null);
assert.equal(nextEpisode([{guid: 'three', episode_number: 3}], {episode_number: 1}, 'TV'), null);
assert.equal(nextEpisode(episodes, {episode_number: 1}, 'Movie'), null);
assert.equal(nextEpisode([{guid: 'two', episode_number: 2, season_number: 2}], {episode_number: 1, season_number: 1}, 'TV'), null);
const src = fs.readFileSync('./src/views/Play/VideoPlayer.vue', 'utf8');
let resolvePlay; let plays = 0; const notices = [];
const context = vm.createContext({nextEpisode, EpisodeList: {value: episodes}, playInfo: {value: {episode_number: 1}},
  gallery_type: {value: 'TV'}, episode_guid: {value: 'one'}, SendPlayRecord: async () => {},
  play: () => {plays++; return new Promise(resolve => resolvePlay = resolve);},
  COMMON: {ShowMsg: text => notices.push(text)}, errorText: error => error.message});
vm.runInContext(src.slice(src.indexOf('let nextEpisodeBusy ='), src.indexOf('async function switchSubtitleUrl')), context);
const first = context.play_next(); await Promise.resolve(); await context.play_next();
assert.equal(plays, 1); resolvePlay(); await first;
context.play = async () => {throw new Error('fixture failure');};
context.episode_guid.value = 'one'; await context.play_next();
assert.equal(context.episode_guid.value, 'one'); assert.match(notices[0], /fixture failure/);
context.playInfo.value.episode_number = 2; await context.play_next();
assert.equal(plays, 1);
console.log('PASS: last/missing episodes, string numbers, season bounds, duplicate clicks and failure recovery');

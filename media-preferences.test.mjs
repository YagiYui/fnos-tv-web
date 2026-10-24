import assert from 'node:assert/strict';
import {choosePreferredSubtitle, subtitleLanguageChoices, subtitleLanguageLabel,
  choosePreferredQuality, qualityPreferenceFallback} from './src/views/Play/media-preferences.js';
import {externalPlayerChoices} from './src/views/Play/external-player.js';
const tracks = [
  {guid:'en', language:'eng', is_default:1}, {guid:'traditional',language:'zh-TW'},
  {guid:'simple',language:'zh_CN'}, {guid:'chinese',language:'zho'}, {guid:'unknown',title:'简体中文字幕'},
];
assert.equal(choosePreferredSubtitle(tracks,'en','zh-CN').guid,'simple');
assert.equal(choosePreferredSubtitle(tracks,'en','chi').guid,'traditional');
assert.equal(choosePreferredSubtitle(tracks,'chinese','').guid,'chinese');
assert.equal(choosePreferredSubtitle(tracks,'missing','fr').guid,'en');
assert.equal(choosePreferredSubtitle(tracks,'en','off'),null);
assert.equal(choosePreferredSubtitle(tracks,'en','zh',''),null);
assert.equal(choosePreferredSubtitle(tracks,'en','off','simple').guid,'simple');
assert.equal(choosePreferredSubtitle(tracks,'en','zh','expired').guid,'traditional');
assert.equal(choosePreferredSubtitle([],null,'zh'),null);
assert.equal(choosePreferredSubtitle([{guid:'file',title:'中文'}],null,'zh').guid,'file');
const choices=subtitleLanguageChoices([...tracks,{language:'<img src=x onerror=bad>'}], 'jpn');
assert.equal(choices.some(row=>row.value.includes('<')),false);
assert.equal(choices.some(row=>row.value==='jpn'),true);
assert.match(subtitleLanguageLabel('eng'),/英语/);
assert.equal(subtitleLanguageLabel('<b>').includes('<'),false);

const qualities=[{resolution:'1080',bitrate:8e6},{resolution:'4k',bitrate:20e6},
  {resolution:'1080',bitrate:4e6},{resolution:'480',bitrate:1e6},{resolution:'720p',bitrate:2e6}];
assert.equal(choosePreferredQuality(qualities,'720').resolution,'720p');
assert.equal(qualityPreferenceFallback(choosePreferredQuality(qualities,'720'),'720'),false);
assert.equal(choosePreferredQuality(qualities,'1080').bitrate,8e6);
assert.equal(choosePreferredQuality(qualities,'4k').resolution,'4k');
assert.equal(choosePreferredQuality(qualities,'highest',qualities[1]),qualities[1]);
assert.equal(choosePreferredQuality(qualities,'highest',qualities[2]),qualities[2], 'Preserve the existing highest-available selector policy');
assert.equal(choosePreferredQuality(qualities,'unknown'),qualities[0]);
assert.equal(choosePreferredQuality(qualities.filter(row=>row.resolution!=='720p'),'720').resolution,'480');
assert.equal(qualityPreferenceFallback(choosePreferredQuality(qualities,'360'),'360'),true);
assert.equal(choosePreferredQuality(qualities.slice(0,3),'360').bitrate,8e6, 'When all are higher, use the lowest available resolution at its best bitrate');
assert.equal(choosePreferredQuality([{resolution:'original',bitrate:9e6}],'720').resolution,'original');
assert.equal(choosePreferredQuality([{resolution:'720',bitrate:false}]),null);
assert.equal(choosePreferredQuality([{resolution:'720',bitrate:-1}]),null);
assert.equal(choosePreferredQuality([], '4k'),null);

const ids=(ua,touch)=>externalPlayerChoices(ua,touch).map(row=>row.value);
assert.deepEqual(ids('Windows'),['','potplayer','vlc']);
assert.ok(ids('Android').includes('mxplayer'));assert.equal(ids('Android').includes('potplayer'),false);
assert.ok(ids('iPhone').includes('infuse'));assert.ok(ids('Macintosh',5).includes('infuse'));
assert.equal(ids('Macintosh',5).includes('iina'),false);assert.ok(ids('Macintosh',0).includes('iina'));
assert.deepEqual(ids('unknown'),['','vlc']);
console.log('PASS: subtitle language/fallback and recovery overrides, bounded available qualities, safe labels and platform external choices');

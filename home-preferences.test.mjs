import assert from 'node:assert/strict';
import {HOME_DEFAULTS,validHomePreference,orderedLibraries} from './src/home-preferences.js';
assert.equal(validHomePreference('sections',['libraries','continue','watchlist']),true);
for(const [key,value]of [['sections',['continue','continue','watchlist']],['hiddenSections',['script']],['density','huge'],['showHistory',1],['libraryOrder',['../path']],['unknown',[]]])assert.equal(validHomePreference(key,value),false);
const rows=[{guid:'a'},{guid:'b'},{guid:'c'},{guid:'new'}];
assert.deepEqual(orderedLibraries(rows,{libraryOrder:['c','a','deleted'],hiddenLibraries:['b']}).map(row=>row.guid),['c','a','new']);
assert.deepEqual(rows.map(row=>row.guid),['a','b','c','new'],'Ordering never mutates the server library list');
assert.deepEqual(orderedLibraries(rows,HOME_DEFAULTS),rows);
console.log('PASS: home field validation, real order, hidden entries, deleted ids, new libraries and stable server input');

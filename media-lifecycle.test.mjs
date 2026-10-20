import assert from 'node:assert/strict';
import {replaceMediaEngine,releaseMediaEngine} from './src/views/Play/media-lifecycle.js';
const callbacks=new Map();const player={on:(name,fn)=>callbacks.set(name,fn)};
let first=0,second=0;
replaceMediaEngine(player,()=>({destroy(){first++;}}));
replaceMediaEngine(player,()=>({destroy(){second++;}}));assert.equal(first,1);assert.equal(second,0);
callbacks.get('destroy')();assert.equal(second,1);releaseMediaEngine(player);assert.equal(second,1);
assert.throws(()=>replaceMediaEngine(player,()=>{throw Error('failed');}));releaseMediaEngine(player);
console.log('PASS: previous engine and unmounted engine each destroyed once; failed initialization and repeat cleanup safe');

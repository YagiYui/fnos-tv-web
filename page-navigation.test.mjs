import {mediaDetailTitle} from './src/views/Play/player-presentation.js';
import assert from 'node:assert/strict';
import {pageBackAction} from './src/navigation.js';
const detail={path:'/video',fullPath:'/video?guid=movie',query:{guid:'movie'}};
for(const previous of ['/', '/list?gallery_uid=library', '/video?guid=season']) assert.equal(pageBackAction(detail,previous).type,'back');
for(const previous of [null,undefined,'https://elsewhere.invalid/','//elsewhere.invalid/','/player?guid=movie','/login','/video?guid=movie','/video?guid=movie&gallery_type=Movie']) assert.deepEqual(pageBackAction(detail,previous),{type:'replace',to:'/'});
assert.deepEqual(pageBackAction({path:'/list'},'/video?guid=movie'),{type:'replace',to:'/'});
console.log('PASS: detail history, direct links, external/login/player history exclusion, duplicate item avoidance and library home navigation');

assert.equal(mediaDetailTitle({name:'我推的孩子'},'TV'),'我推的孩子');
assert.equal(mediaDetailTitle({title:'出租车司机'},'Movie'),'出租车司机');
assert.equal(mediaDetailTitle({tv_title:'我推的孩子',title:'第1季'},'season'),'我推的孩子 第1季');
assert.equal(mediaDetailTitle({},'TV'),'');

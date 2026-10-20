import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {initSync,PgsParser} from 'libbitsub/pkg';

// Real media samples stay outside Git. Opt in with PGS_TEST_FILE or an argument.
const fixture=process.env.PGS_TEST_FILE || process.argv[2];
test('decode and render an external PGS sample', {
  skip: fixture ? false : 'Set PGS_TEST_FILE to a local .sup sample (not included in source)',
}, () => {
  const moduleUrl=import.meta.resolve('libbitsub/pkg');
  initSync({module:fs.readFileSync(new URL('./libbitsub_bg.wasm',moduleUrl))});
  const parser=new PgsParser();
  try {
    const count=parser.parse(fs.readFileSync(fixture));assert.ok(count>10);
    const timestamps=parser.getTimestamps();assert.ok(timestamps.length>10);
    for (const index of [0,Math.floor(count/2),Math.max(0,count-2)]) {
      const found=parser.findIndexAtTimestamp(timestamps[index]+1);assert.ok(found>=0);
      const frame=parser.renderAtIndex(found);frame?.free();
    }
    let rendered=false;
    for(let index=0;index<Math.min(count,100);index++){
      const frame=parser.renderAtIndex(index);
      try {
        if(frame?.compositionCount){
          const image=frame.getComposition(0);
          try {
            const rgba=image.getRgba();assert.equal(rgba.length,image.width*image.height*4);
            assert.ok(rgba.some((value,i)=>i%4===3&&value>0));rendered=true;
          } finally { image.free(); }
          break;
        }
      } finally { frame?.free(); }
    }
    assert.ok(rendered);
  } finally { parser.free(); }
});

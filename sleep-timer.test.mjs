import assert from 'node:assert/strict';
import {createSleepTimer, pictureInPictureAvailable, togglePictureInPicture} from './src/views/Play/sleep-timer.js';
let now=0, stopped=0, tasks=new Map(), id=0;
const timer=createSleepTimer({now:()=>now,onStop:()=>stopped++,schedule:fn=>{tasks.set(++id,fn);return id},clear:key=>tasks.delete(key)});
timer.set(15); now=16*60000; // Browser was suspended; a visibility check must stop exactly once.
timer.check(); timer.check(); assert.equal(stopped,1); assert.equal(tasks.size,0); assert.equal(timer.allowsAutoplay(),false);
timer.cancel(); assert.equal(timer.allowsAutoplay(),true);
timer.set(-1); assert.equal(timer.allowsAutoplay(),false); timer.ended(); timer.ended(); assert.equal(stopped,2);
timer.set(30); now+=5*60000; timer.set(60); now+=31*60000; timer.check(); assert.equal(stopped,2);
timer.cancel(); now+=90*60000; timer.check(); assert.equal(stopped,2); assert.equal(tasks.size,0);
timer.set(15); timer.dispose(); now+=16*60000; timer.check(); assert.equal(stopped,2); assert.equal(tasks.size,0);
let calls=[]; const video={requestPictureInPicture:()=>{calls.push('enter');return Promise.resolve()}};
const doc={pictureInPictureEnabled:true,exitPictureInPicture:()=>{calls.push('exit');return Promise.resolve()}};
assert.equal(pictureInPictureAvailable(video,doc),true); await togglePictureInPicture(video,doc);
doc.pictureInPictureElement=video;await togglePictureInPicture(video,doc);assert.deepEqual(calls,['enter','exit']);
doc.pictureInPictureEnabled=false;assert.equal(pictureInPictureAvailable(video,doc),false);await assert.rejects(togglePictureInPicture(video,doc));
console.log('PASS: delayed deadline, one stop, end-of-episode, cancellation, disposal and PiP capability');

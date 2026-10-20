import assert from 'node:assert/strict';
import {installMobileFullscreen} from './src/views/Play/mobile-fullscreen.js';
function fixture({native=false,lockFails=false}={}) {
 const classes=new Set(),styles=new Map(),events=new Map(),listeners=new Map(),frames=new Map();
 const style={getPropertyValue:k=>styles.get(k)?.[0]||'',getPropertyPriority:k=>styles.get(k)?.[1]||'',setProperty:(k,v,p)=>styles.set(k,[v,p]),removeProperty:k=>styles.delete(k)};
 style.setProperty('width','100%');
 const player={style,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,v)=>v?classes.add(c):classes.delete(c)}};
 let control,requests=0,locks=0,unlocks=0,web=false,id=0;
 const doc={body:{style:{overflow:'auto'}},documentElement:{clientWidth:390,clientHeight:844,style:{overflow:''}},async exitFullscreen(){art.emit('fullscreen',false);}};
 const win={navigator:{userAgent:'Android',maxTouchPoints:5},matchMedia:()=>({matches:true}),screen:{orientation:{async lock(){locks++;if(lockFails)throw Error('not supported');},unlock(){unlocks++;}}},requestAnimationFrame:f=>{frames.set(++id,f);return id;},cancelAnimationFrame:n=>frames.delete(n),addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const art={constructor:{},template:{$player:player,$video:{videoWidth:1920,videoHeight:1080}},controls:{add:c=>control=c},proxy(){},on:(n,f)=>events.set(n,f),off:n=>events.delete(n),emit:(n,...a)=>events.get(n)?.(...a),get fullscreenWeb(){return web;},set fullscreenWeb(v){web=v;art.emit('fullscreenWeb',v);}};
 if(native)player.requestFullscreen=async()=>{requests++;art.emit('fullscreen',true);};
 const dispose=installMobileFullscreen(art,win,doc);
 const flush=()=>{for(const [i,f] of [...frames]){frames.delete(i);f();}};
 return {art,win,doc,player,classes,styles,listeners,dispose,flush,click:()=>control.click(),get requests(){return requests;},get locks(){return locks;},get unlocks(){return unlocks;}};
}
// HTTP/iOS-style unsupported native fullscreen keeps custom subtitle layers and rotates the player.
const web=fixture();web.click();await Promise.resolve();web.flush();
assert.equal(web.art.fullscreenWeb,true);assert.equal(web.art.isRotate,true);
assert.equal(web.styles.get('width')[0],'844px');assert.equal(web.styles.get('height')[0],'390px');
assert.equal(web.doc.body.style.overflow,'hidden');
web.doc.documentElement.clientWidth=844;web.doc.documentElement.clientHeight=390;web.listeners.get('resize')();web.flush();
assert.equal(web.art.isRotate,false);assert.equal(web.styles.get('width')[0],'100%');
web.click();web.flush();assert.equal(web.doc.body.style.overflow,'auto');assert.equal(web.classes.has('fnos-mobile-fullscreen'),false);
web.dispose();assert.equal(web.listeners.size,0);
// A rejected orientation lock still renders landscape without an unhandled rejection.
const denied=fixture({native:true,lockFails:true});denied.click();await new Promise(r=>setTimeout(r,0));denied.flush();
assert.equal(denied.requests,1);assert.equal(denied.locks,1);assert.equal(denied.art.isRotate,true);
denied.click();await Promise.resolve();denied.flush();assert.equal(denied.art.isRotate,false);denied.dispose();
// A successful lock is released on exit and unmount restores dimensions.
const native=fixture({native:true});native.click();await new Promise(r=>setTimeout(r,0));native.flush();native.click();await Promise.resolve();native.flush();
assert.equal(native.unlocks,1);assert.equal(native.styles.get('width')[0],'100%');native.dispose();
const pending=fixture();pending.click();pending.dispose();pending.flush();assert.equal(pending.art.fullscreenWeb,false);assert.equal(pending.doc.body.style.overflow,'auto');
console.log('PASS: native fullscreen, rejected lock fallback, rotated web fullscreen, physical rotation, exit and unmount cleanup');

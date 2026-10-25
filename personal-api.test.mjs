import assert from 'node:assert/strict';
import {personalRequest} from './src/personal-api.js';
const original=globalThis.fetch;let request;
try{
 globalThis.fetch=async(path,options)=>{request={path,options};return {ok:true,status:200,json:async()=>({code:0,data:{contains:true}})}};
 assert.equal((await personalRequest('watchlist/item',{method:'PUT',token:'synthetic-owner'})).contains,true);
 assert.equal(request.path,'/danmu/personal/watchlist/item');assert.equal(request.options.headers.Authorization,'synthetic-owner');
 assert.equal(request.options.body,undefined,'Credentials never enter URL or JSON data');
 globalThis.fetch=async()=>({ok:false,status:409,json:async()=>({code:-3,msg:'conflict'})});
 await assert.rejects(personalRequest('preferences/player',{token:'fixture'}),error=>error.status===409&&error.code===-3);
 globalThis.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'}))));
 await assert.rejects(personalRequest('watchlist',{token:'fixture',timeout:1}),{name:'AbortError'});
 await assert.rejects(personalRequest('watchlist',{token:''}),/登录/);
}finally{globalThis.fetch=original;}
console.log('PASS: authenticated personal request namespace, header-only credentials, business conflicts and bounded timeout');

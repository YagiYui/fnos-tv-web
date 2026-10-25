import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {BrowseSnapshots} from './src/browse-snapshots.js';
const script=name=>fs.readFileSync('./src/components/'+name+'.vue','utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'');
const snapshots=new BrowseSnapshots();snapshots.setAccount('alice');
const account=Vue.reactive({account:'alice',revision:snapshots.revision,get:(...args)=>snapshots.get(...args),save:(...args)=>snapshots.save(...args)});
const changes=Vue.reactive({revision:0,overrides:{},notify(id,contains){this.overrides[id]=contains;this.revision++}});
const rows=Array.from({length:23},(_,index)=>({guid:'film-'+index,type:'Movie'}));
let current=0,maximum=0,held=null,unmount;
const api=async(path,options={})=>{
 if(held&&path.startsWith('watchlist?'))return new Promise(resolve=>{held=resolve;});
 if(path.startsWith('watchlist?')){const page=Number(new URLSearchParams(path.split('?')[1]).get('page'));return {items:rows.slice((page-1)*21,page*21),total:rows.length};}
 if(options.method==='DELETE'){const index=rows.findIndex(row=>path.endsWith('/'+row.guid));if(index>=0)rows.splice(index,1);return {contains:false};}
 return {contains:true};
};
const common={userKey:'alice',imgUrl:'',async requests(method,path){current++;maximum=Math.max(maximum,current);await new Promise(setImmediate);current--;return {guid:path.split('/').at(-1),type:'Movie',title:'Fixture',posters:'poster.webp'};}};
const scope=Vue.effectScope(),ctx=vm.createContext({...Vue,AbortController,URLSearchParams,defineProps:()=>({preview:false}),
 getCurrentInstance:()=>({appContext:{config:{globalProperties:{$COMMON:common}}}}),personalRequest:api,
 useBrowseSnapshots:()=>account,useWatchlistChanges:()=>changes,inject:()=>({getTop:()=>123,scrollTo(){}}),
 onMounted(){},onBeforeRouteLeave(){},onBeforeUnmount(fn){unmount=fn;}});
scope.run(()=>vm.runInContext(script('WatchlistCollection'),ctx));
const read=expr=>vm.runInContext(expr,ctx);
await ctx.load();assert.equal(read('items.value.length'),21);assert.equal(maximum,3,'Official metadata reads stay bounded');
await ctx.load(2);assert.equal(read('items.value.length'),2);assert.equal(read('page.value'),2);
await ctx.remove(read('items.value[0]'));assert.equal(read('visible.value.length'),1);
await ctx.remove(read('items.value[1]'));await ctx.load(2);assert.equal(read('page.value'),1,'Removing the last page falls back to a real page');
held=true;const stale=ctx.load();account.account='bob';account.revision++;common.userKey='bob';held({items:[{guid:'private-alice',type:'Movie'}],total:1});held=null;await stale;
assert.equal(read('items.value.length'),0,'An old account cannot populate the new view');
unmount();scope.stop();
let contains=false,buttonUnmount;const props=Vue.reactive({guid:'movie'}),notified=[];
const buttonScope=Vue.effectScope(),button=vm.createContext({...Vue,AbortController,defineProps:()=>props,
 useBrowseSnapshots:()=>account,useWatchlistChanges:()=>({notify:(...args)=>notified.push(args)}),
 personalRequest:async(path,options={})=>{if(options.method==='PUT')contains=true;if(options.method==='DELETE')contains=false;return {contains};},
 onBeforeUnmount:fn=>{buttonUnmount=fn;}});
buttonScope.run(()=>vm.runInContext(script('WatchlistButton'),button));await new Promise(setImmediate);
await button.toggle();assert.equal(contains,true);await button.toggle();assert.equal(contains,false);assert.equal(notified.length,2);
buttonUnmount();buttonScope.stop();
console.log('PASS: actual watchlist handlers, finite pages, bounded metadata, last-page removal, account cancellation, and independent detail add/remove');

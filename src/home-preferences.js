import {defineStore} from 'pinia';
import {ref,watch} from 'vue';
import VueCookies from 'vue-cookies';
import {useBrowseSnapshots} from './store.js';
import {personalRequest} from './personal-api.js';
import {PreferenceSync} from './preference-sync.js';
export const HOME_DEFAULTS=Object.freeze({sections:['continue','watchlist','libraries'],hiddenSections:[],libraryOrder:[],hiddenLibraries:[],density:'comfortable',showHistory:true});
export function validHomePreference(name,value){
 if(name==='density')return ['comfortable','compact'].includes(value);
 if(name==='showHistory')return typeof value==='boolean';
 if(!['sections','hiddenSections','libraryOrder','hiddenLibraries'].includes(name)||!Array.isArray(value)||value.length>1000||new Set(value).size!==value.length)return false;
 if(name==='sections'||name==='hiddenSections')return value.every(row=>HOME_DEFAULTS.sections.includes(row))&&(name!=='sections'||value.length===HOME_DEFAULTS.sections.length);
 return value.every(row=>typeof row==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(row));
}
export function orderedLibraries(libraries,preferences){
 const hidden=new Set(preferences.hiddenLibraries||[]),order=preferences.libraryOrder||[];
 return (libraries||[]).filter(row=>!hidden.has(row.guid)).map((row,index)=>({row,index,rank:order.indexOf(row.guid)}))
  .sort((a,b)=>(a.rank<0?order.length+a.index:a.rank)-(b.rank<0?order.length+b.index:b.rank)).map(entry=>entry.row);
}
export const useHomePreferences=defineStore('HomePreferences',()=>{
 const account=useBrowseSnapshots(),values=ref(structuredClone(HOME_DEFAULTS)),status=ref('local');let sync=null;
 function persist(){try{localStorage.setItem('fnosHome:'+account.account,JSON.stringify(values.value));return true;}catch{return false;}}
 watch(()=>account.revision,()=>{
  sync?.dispose();values.value=structuredClone(HOME_DEFAULTS);status.value='local';
  if(!account.account)return;
  const revision=account.revision,owner=account.account,token=VueCookies.get('authorization')||'';let saved={};
  try{const raw=JSON.parse(localStorage.getItem('fnosHome:'+owner));for(const [name,value]of Object.entries(raw||{}))if(validHomePreference(name,value))saved[name]=value;}catch{}
  values.value={...values.value,...saved};
  const current=()=>revision===account.revision&&owner===account.account;
  sync=new PreferenceSync({defaults:HOME_DEFAULTS,isCurrent:current,seed:()=>saved,
   request:(method,data,signal)=>personalRequest('preferences/home',{method,data,signal,token,timeout:5000}),
   writeLocal:(name,value)=>{if(validHomePreference(name,value)){values.value={...values.value,[name]:value};persist();}},
   onFailure:()=>{status.value='error';}});
  const active=sync;void active.load().then(ok=>{if(current()&&ok)status.value='synced';});
 },{immediate:true,flush:'sync'});
 async function save(patch){
  if(!sync||!account.account||Object.entries(patch).some(([name,value])=>!validHomePreference(name,value)))return false;
  if(!Object.keys(patch).length)return true;
  const copy=JSON.parse(JSON.stringify(patch)),active=sync;values.value={...values.value,...copy};persist();
  const pending=Object.entries(copy).map(([name,value])=>active.save(name,value));const results=await Promise.all(pending);
  if(active===sync)status.value=results.every(Boolean)?'synced':'error';return results.every(Boolean);
 }
 async function reset(){
  if(!sync)return false;const active=sync;values.value=structuredClone(HOME_DEFAULTS);persist();const ok=await active.reset();
  if(active===sync)status.value=ok?'synced':'error';return ok;
 }
 return {values,status,save,reset};
});

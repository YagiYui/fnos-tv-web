import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/views/Play/VideoPlayer.vue','utf8');
const code=source.slice(source.indexOf('async function putVideoConfig()'),source.indexOf('// 添加字幕切换函数'));
const ref=value=>({value});let resolve,requests=0,loads=0,notices=[];
const context=vm.createContext({preferenceHandle:{isCurrent:()=>true},canEditSharedConfig:ref(true),episode_guid:ref('one'),guid:ref('season'),
  seasonConfig:ref({list:[],url:[]}),skipList:ref(['keep']),showSetUp:ref(true),VueCookies:{get:()=> 'fictional'},
  COMMON:{ShowMsg:message=>notices.push(message)},errorText:e=>e.message,loadDanmuku:()=>{loads++},
  art:{plugins:{artplayerPluginDanmuku:{load(){loads++}}}},
  axios:{post:()=>{requests++;return new Promise(r=>resolve=r)},get:()=>{requests++;return new Promise(r=>resolve=r)}}});
vm.runInContext(code,context);
let pending=context.putVideoConfig();context.preferenceHandle={isCurrent:()=>true}; // A -> B -> A keeps the same token, but a new lifetime.
resolve({data:{code:0}});await pending;
assert.deepEqual(context.skipList.value,['keep']);assert.equal(context.showSetUp.value,true);assert.equal(loads,0);
pending=context.getVideoConfig();context.preferenceHandle={isCurrent:()=>true};resolve({data:{list:[{startTime:1,endTime:2}],url:[],permissions:{edit_shared:true}}});await pending;
assert.equal(context.canEditSharedConfig.value,false);assert.deepEqual(context.skipList.value,['keep']);
const count=requests;await context.putVideoConfig();assert.equal(requests,count,'Readonly client cannot submit');
context.canEditSharedConfig.value=true;pending=context.putVideoConfig();resolve({data:{code:0}});await pending;
assert.equal(context.skipList.value.length,0);assert.equal(context.showSetUp.value,false);assert.equal(loads,2);assert.deepEqual(notices,[]);
console.log('PASS: shared read/write ownership, A-B-A stale results, readonly writes and successful current save');

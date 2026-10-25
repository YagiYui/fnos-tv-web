import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('./src/views/Play/DanmakuSourcesDialog.vue', 'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm, '');
const config = {revision: 2, fallback: true, default_source: 'auto', providers: [{id:'bilibili',name:'B站',enabled:false},{id:'youku',name:'优酷',enabled:true}],
  searches:[{id:'360',name:'360影视',enabled:true}],custom:[{id:'custom-test',name:'Fixture',url:'https://example.invalid',enabled:true,has_token:true}]};
let mounted, unmounted, finish;
const calls = [], emitted = [];
const request = async (path, options = {}) => {
  calls.push({path, options});
  if (options.method === 'PUT' && path === '/danmu/sources' && finish === 'wait') return new Promise(resolve => { finish = resolve; });
  if (path === '/danmu/sources') return {code:0,data:structuredClone(config),can_manage:true};
  if (path.startsWith('/danmu/sources/preferences')) return {code:0,data:{source_id:'youku',fallback:false,scope:'user'}};
  return {code:0,data:{connection:true,search:true,episodes:null,comments:null}};
};
const context = vm.createContext({ref: value => ({value}), computed: fn => ({get value() {return fn();}}), AbortController, URLSearchParams,
  defineProps:()=>({request,episodeGuid:'episode',parentGuid:'season'}),defineEmits:()=>(...args)=>emitted.push(args),
  onMounted:fn=>{mounted=fn;},onBeforeUnmount:fn=>{unmounted=fn;}});
vm.runInContext(source, context);
const read = expression => vm.runInContext(expression, context);
await mounted(); assert.equal(read('preferred.value'),'youku'); assert.equal(read('currentScope.value'),'user');
assert.equal(read('config.value.custom[0].token'),'');
assert.equal(read('choices.value.some(row=>row.value==="bilibili")'),false,'A disabled source never appears as an available preference');
read('config.value.custom[0].token="synthetic-secret"');
await context.saveConfig();
assert.equal(JSON.parse(calls.at(-1).options.body).custom[0].token,'synthetic-secret');
assert.equal(read('config.value.custom[0].token'),'','Never retain a typed secret after a save response');
read('scope.value="episode"');await context.savePreference(false);
const preference = JSON.parse(calls.at(-1).options.body);
assert.equal(preference.scope,'episode');assert.equal(preference.guid,'episode');assert.equal(preference.parent_guid,'season');
assert.equal(preference.fallback,false); assert.ok(emitted.some(row=>row[0]==='saved'));
await context.check(config.custom[0]);assert.match(read('checkResult.value'),/未验证（搜索为空）/);
finish='wait'; const pending=context.saveConfig(), count=calls.length;
await context.saveConfig();assert.equal(calls.length,count,'Repeated clicks cannot issue duplicate config writes');
const prior=read('config.value');unmounted();
finish({code:0,data:{...config,revision:999}});await pending;
assert.equal(read('config.value'),prior,'A closed account dialog ignores a late save response');
assert.equal(calls.at(-1).options.signal.aborted,true);
console.log('PASS: source dialog role choices, scoped requests, masked secret lifecycle, truthful protocol stages, duplicate write guard and unmount cancellation');

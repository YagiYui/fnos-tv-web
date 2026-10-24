<script setup>
import {onBeforeUnmount,ref} from 'vue';
import {useHomePreferences} from '../home-preferences.js';
const props=defineProps({libraries:{type:Array,default:()=>[]}}),emit=defineEmits(['close']);
const copy=value=>JSON.parse(JSON.stringify(value));
const settings=useHomePreferences(),draft=ref(copy(settings.values)),busy=ref(false),note=ref('');
const original=copy(settings.values);let active=true;
const titles={continue:'继续观看',watchlist:'待看清单',libraries:'最近入库／媒体库'};
draft.value.libraryOrder=[...new Set([...(draft.value.libraryOrder||[]),...props.libraries.map(row=>row.guid)])];
original.libraryOrder=[...draft.value.libraryOrder];
function move(kind,index,offset){const rows=draft.value[kind],next=index+offset;if(next<0||next>=rows.length)return;[rows[index],rows[next]]=[rows[next],rows[index]];}
function visible(kind,id,on){const key=kind==='section'?'hiddenSections':'hiddenLibraries';draft.value[key]=on?draft.value[key].filter(row=>row!==id):[...new Set([...draft.value[key],id])];}
async function apply(){
 if(busy.value)return;busy.value=true;
 const patch=Object.fromEntries(Object.entries(draft.value).filter(([name,value])=>JSON.stringify(value)!==JSON.stringify(original[name])));
 const ok=await settings.save(patch);if(!active)return;busy.value=false;
 if(ok)emit('close');else note.value='本设备已应用，账号同步未完成；刷新后可能读取服务器的旧设置，请稍后再保存。';
}
async function reset(){if(busy.value)return;busy.value=true;const ok=await settings.reset();if(!active)return;draft.value=copy(settings.values);busy.value=false;note.value=ok?'本账号首页设置已恢复默认':'本设备已恢复，跨设备同步失败，请稍后重试';}
onBeforeUnmount(()=>{active=false;});
</script>
<template>
 <n-modal :show="true" preset="card" title="首页设置" :style="{width:'min(600px,94vw)',maxHeight:'85vh',overflowY:'auto'}" @update:show="value=>{if(!value)emit('close')}">
  <n-space vertical :size="16">
   <n-text depth="3">按账号保存；同一账号刷新其他设备后读取。调整顺序同时改变键盘与屏幕显示顺序。</n-text>
   <n-alert v-if="note" type="info">{{note}}</n-alert>
   <n-text>栏目开关与顺序</n-text>
   <div v-for="(id,index) in draft.sections" :key="id" class="home-setting-row"><n-checkbox :checked="!draft.hiddenSections.includes(id)" :disabled="busy" @update:checked="value=>visible('section',id,value)">{{titles[id]}}</n-checkbox><n-space :size="4"><n-button size="tiny" :disabled="busy||index===0" @click="move('sections',index,-1)">上移</n-button><n-button size="tiny" :disabled="busy||index===draft.sections.length-1" @click="move('sections',index,1)">下移</n-button></n-space></div>
   <n-text>媒体库开关与顺序</n-text>
   <div v-for="(id,index) in draft.libraryOrder" :key="id" class="home-setting-row"><template v-if="libraries.some(row=>row.guid===id)"><n-checkbox :checked="!draft.hiddenLibraries.includes(id)" :disabled="busy" @update:checked="value=>visible('library',id,value)">{{libraries.find(row=>row.guid===id)?.title}}</n-checkbox><n-space :size="4"><n-button size="tiny" :disabled="busy||index===0" @click="move('libraryOrder',index,-1)">上移</n-button><n-button size="tiny" :disabled="busy||index===draft.libraryOrder.length-1" @click="move('libraryOrder',index,1)">下移</n-button></n-space></template></div>
   <n-select v-model:value="draft.density" :disabled="busy" :options="[{value:'comfortable',label:'海报密度：舒适'},{value:'compact',label:'海报密度：紧凑'}]" />
   <n-checkbox v-model:checked="draft.showHistory" :disabled="busy">显示首页搜索历史</n-checkbox>
   <n-space><n-button type="primary" :loading="busy" @click="apply">应用首页设置</n-button><n-popconfirm @positive-click="reset"><template #trigger><n-button :disabled="busy">恢复首页默认</n-button></template>恢复当前账号首页默认设置并同步其他设备？</n-popconfirm></n-space>
  </n-space>
 </n-modal>
</template>
<style scoped>.home-setting-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.home-setting-row:empty{display:none}</style>

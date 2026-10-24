<script setup>
import {computed,getCurrentInstance,inject,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';
import {personalRequest} from '../personal-api.js';
import {useBrowseSnapshots} from '../store.js';
import {useWatchlistChanges} from '../watchlist-store.js';
import HomeCarousel from './HomeCarousel.vue';
import MediaImage from './MediaImage.vue';
const props=defineProps({preview:Boolean,mobile:Boolean,perView:{type:Number,default:7}});
const COMMON=getCurrentInstance().appContext.config.globalProperties.$COMMON;
const account=useBrowseSnapshots(),changes=useWatchlistChanges();
const page=ref(1),items=ref([]),total=ref(0),busy=ref(false),error=ref('');
const pageScroll=inject('pageScroll',{getTop:()=>window.scrollY,scrollTo:top=>window.scrollTo(0,top)});
const savedView=props.preview?null:account.get(account.account,'watchlist-view');
if(Number.isInteger(savedView?.page)&&savedView.page>0)page.value=savedView.page;
const visible=computed(()=>items.value.filter(item=>changes.overrides[item.guid]!==false));
const recentUpdates=computed(()=>visible.value.filter(item=>item.update?.available&&item.update.delta>0&&item.update.changed_at>=Date.now()/1000-7*86400));
let controller=null,generation=0,mounted=false;
const key=()=>`watchlist:${page.value}`;
function cancel(){generation++;controller?.abort();}
function restore(){const saved=account.get(account.account,key());items.value=saved?.items||[];total.value=saved?.total||0;}
function save(){account.save(account.account,key(),{items:items.value,total:total.value},account.revision);}
async function load(target=page.value){
 if(!props.preview&&target!==page.value)pageScroll.scrollTo(0);
 cancel();page.value=target;restore();error.value='';busy.value=false;
 if(!account.account||account.account!==COMMON.userKey)return;
 const run=generation,owner=account.revision;controller=new AbortController();const signal=controller.signal;
 const current=()=>run===generation&&owner===account.revision&&!signal.aborted;
 busy.value=true;
 try{
  const result=await personalRequest(`watchlist?page=${target}&page_size=21`,{signal});if(!current())return;
  if(!Array.isArray(result?.items)||!Number.isInteger(result.total))throw new Error('待看数据无效');
  const rows=new Array(result.items.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,result.items.length)},async()=>{
   while(cursor<result.items.length&&current()){
    const index=cursor++,entry=result.items[index];
    try{
     const item=await COMMON.requests('GET','/api/v1/item/'+entry.guid,true,{}, {signal});
     if(!item||item.guid!==entry.guid||!['Movie','TV'].includes(item.type))throw new Error('暂时无法读取');
     rows[index]={...item,posterSrc:typeof item.poster==='string'&&item.poster?COMMON.imgUrl+item.poster:typeof item.posters==='string'&&item.posters?COMMON.imgUrl+'/92/17/'+item.posters+'?w=300':'/images/not_video.jpg'};
     if(item.type==='TV'&&current()){
      try{rows[index].update=await personalRequest('updates/'+encodeURIComponent(item.guid),{method:'PUT',signal});}catch{/* Updates are optional; the watchlist stays usable. */}
     }
    }catch{rows[index]={guid:entry.guid,type:entry.type,title:'暂时无法读取此影片',unavailable:true,posterSrc:'/images/not_video.jpg'};}
   }
  }));
  if(!current())return;
  items.value=rows;total.value=result.total;save();
  if(!rows.length&&target>1)await load(Math.max(1,Math.ceil(total.value/21)));
 }catch(failure){if(current()&&failure.name!=='AbortError')error.value=failure.message||'待看加载失败';}
 finally{if(current())busy.value=false;}
}
async function remove(item){
 const owner=account.revision,run=generation;
 try{
  const result=await personalRequest('watchlist/'+encodeURIComponent(item.guid),{method:'DELETE',signal:controller?.signal});
  if(owner!==account.revision||run!==generation)return;
  changes.notify(item.guid,result.contains);
 }catch(failure){if(owner===account.revision&&failure.name!=='AbortError')error.value=failure.message;}
}
watch(()=>account.revision,()=>{cancel();items.value=[];total.value=0;page.value=1;if(mounted)void load();},{flush:'sync'});
watch(()=>changes.revision,()=>{if(mounted)void load();});
onMounted(async()=>{mounted=true;restore();if(!props.preview){await nextTick();pageScroll.scrollTo(savedView?.scrollY||0);}void load();});
onBeforeRouteLeave(()=>{if(!props.preview)account.save(account.account,'watchlist-view',{page:page.value,scrollY:pageScroll.getTop()},account.revision);cancel();});
onBeforeUnmount(()=>{mounted=false;cancel();});
</script>
<template>
 <section class="card-shows watchlist-collection" :aria-busy="busy">
  <div class="section-heading"><h2 v-if="preview">待看清单</h2><h1 v-else>待看清单</h1><router-link v-if="preview" to="/watchlist" class="section-more">查看全部</router-link><n-button v-else text :loading="busy" @click="load()">刷新</n-button></div>
  <p class="page-description">独立于收藏，按账号保存。<span v-if="!preview">共 {{ total }} 项。</span></p>
  <n-alert v-if="error" type="error">{{ error }} <n-button text @click="load()">重试</n-button></n-alert>
  <div v-if="recentUpdates.length" class="observed-updates"><h3>最近观察到的剧集变化</h3><p class="page-description">显示最近七天观察到的本地分集数增加，不代表官方上架时间或未看数量；只检查本页待看剧集。</p><p v-for="item in recentUpdates" :key="item.guid"><router-link :to="{path:'/video',query:{guid:item.guid,gallery_type:'TV'}}">{{item.title||item.name}}：{{item.update.previous_count}} → {{item.update.count}} 集</router-link></p></div>
  <component :is="preview ? HomeCarousel : 'div'" v-if="visible.length" :items="preview?visible:undefined" :per-view="perView" :mobile="mobile" :class="preview?'':'view-card-list'">
   <template v-if="preview" #default="{item}">
    <div class="view-item poster-card"><router-link v-if="!item.unavailable" :to="{path:'/video',query:{guid:item.guid,gallery_type:item.type}}"><div class="poster-art"><MediaImage :src="item.posterSrc" :alt="item.title||item.name" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span></div><div class="view-item-title">{{item.title||item.name}}</div></router-link><div v-else><div class="poster-art"><MediaImage :src="item.posterSrc" alt="暂无海报" /></div><div class="view-item-title">{{item.title}}</div></div><n-button text size="small" :aria-label="'从待看移除'+(item.title||item.name)" @click="remove(item)">移出待看</n-button></div>
   </template>
   <template v-else #default>
    <div v-for="item in visible" :key="item.guid" class="view-item poster-card"><router-link v-if="!item.unavailable" :to="{path:'/video',query:{guid:item.guid,gallery_type:item.type}}"><div class="poster-art"><MediaImage :src="item.posterSrc" :alt="item.title||item.name" loading="lazy" /><span class="poster-play"><i class="bx bx-play"></i></span></div><div class="view-item-title">{{item.title||item.name}}</div></router-link><div v-else><div class="poster-art"><MediaImage :src="item.posterSrc" alt="暂无海报" /></div><div class="view-item-title">{{item.title}}</div></div><n-button text size="small" :aria-label="'从待看移除'+(item.title||item.name)" @click="remove(item)">移出待看</n-button></div>
   </template>
  </component>
  <p v-if="busy&&!visible.length" role="status">正在读取待看清单…</p><n-empty v-else-if="!visible.length&&!error" description="暂无待看，可在影片详情中加入" />
  <div v-if="!preview&&total>21" class="catalog-pagination"><n-button :disabled="busy||page<=1" @click="load(page-1)">上一页</n-button><span>第 {{ page }} / {{ Math.max(1,Math.ceil(total/21)) }} 页</span><n-button :disabled="busy||page*21>=total" @click="load(page+1)">下一页</n-button></div>
 </section>
</template>

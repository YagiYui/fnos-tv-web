import {nextEpisode,continuePlaybackRoute} from './views/Play/player-presentation.js';
export function watchingProgress(item){
 const duration=Number(item?.duration),position=Number(item?.ts??0),valid=Number.isFinite(duration)&&duration>0&&Number.isFinite(position)&&position>=0;
 const marked=Number(item?.watched)===1;
 return {completed:(valid&&position>=Math.max(1,Math.floor(duration)))||(marked&&position===0),
  remaining:valid?Math.max(0,Math.ceil(duration-position)):null,percent:valid?Math.min(100,Math.max(0,position/duration*100)):null};
}
export function continueCards(records,nextEntries={}){
 const result=[];
 for(const item of records||[]){
  const progress=watchingProgress(item);
  if(!progress.completed){result.push({...item,continueRecordGuid:item.guid,continueKind:'resume',continueRoute:continuePlaybackRoute(item)});}
  else if(item.type==='Episode'){
   const next=nextEntries[item.guid];
   if(next?.guid){const target={...item,...next,type:'Episode',parent_guid:item.parent_guid,ts:0,watched:0,duration:0,poster:next.poster||item.poster,tv_title:item.tv_title};result.push({...target,continueRecordGuid:item.guid,continueKind:'next',continueRoute:continuePlaybackRoute(target)});}
   else if(next?.error&&item.parent_guid)result.push({...item,continueRecordGuid:item.guid,continueKind:'lookup-error',continueRoute:{path:'/video',query:{guid:item.parent_guid,gallery_type:'season'}}});
  }
  if(result.length>=21)break;
 }
 return result;
}
export async function resolveContinueNext(request,records,{signal}={}){
 const candidates=(records||[]).filter(row=>row.type==='Episode'&&watchingProgress(row).completed).slice(0,21),result={},parents=new Map();let cursor=0;
 await Promise.all(Array.from({length:Math.min(2,candidates.length)},async()=>{
  while(cursor<candidates.length&&!signal?.aborted){
   const row=candidates[cursor++];if(!row.parent_guid){result[row.guid]=null;continue;}
   try{
    if(!parents.has(row.parent_guid))parents.set(row.parent_guid,request('GET','/api/v1/episode/list/'+row.parent_guid,true,{}, {signal}));
    const episodes=await parents.get(row.parent_guid);if(!Array.isArray(episodes))throw new Error('分集列表无效');
    result[row.guid]=nextEpisode(episodes,row,'Episode');
   }catch{if(!signal?.aborted)result[row.guid]={error:true};}
  }
 }));
 if(signal?.aborted)throw Object.assign(new Error('继续观看请求已取消'),{name:'AbortError'});
 return result;
}

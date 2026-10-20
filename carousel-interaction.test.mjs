import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {computed, ref, watch} from 'vue'
import {startSwipe,moveSwipe,finishSwipe} from './src/components/direction-locked-swipe.js'
const props={mobile:false,perView:7,items:Array.from({length:15},(_,guid)=>({guid}))}
const mounted=[],unmounted=[],listeners=new Set(),calls=[]
const mouse={matches:true,addEventListener:(name,fn)=>listeners.add('mouse'),removeEventListener:()=>listeners.delete('mouse')}
const touch={matches:false,addEventListener:(name,fn)=>listeners.add('touch'),removeEventListener:()=>listeners.delete('touch')}
const context=vm.createContext({computed,ref,watch,startSwipe,moveSwipe,finishSwipe,defineProps:()=>props,
  onMounted:fn=>mounted.push(fn),onUnmounted:fn=>unmounted.push(fn),Date,
  window:{matchMedia:q=>q.includes('hover')?mouse:touch},navigator:{maxTouchPoints:0}})
const script=fs.readFileSync('./src/components/HomeCarousel.vue','utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
vm.runInContext(script+';globalThis.test={pages,hasMouse,showPagination,carousel,touchStart,touchMove,touchEnd};',context)
const t=context.test
t.carousel.value={to:index=>calls.push(index)}
mounted.forEach(fn=>fn())
assert.equal(listeners.size,2)
assert.deepEqual(Array.from(t.pages.value,p=>p.length),[7,7,1])
assert.equal(t.hasMouse.value,true)
const e=(x,y)=>({touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],currentTarget:{clientWidth:1280}})
t.touchStart(e(0,0));t.touchMove(e(3,20));t.touchEnd(e(30,160))
assert.equal(calls.length,0,'wide-screen vertical gesture must not move')
t.touchStart(e(0,0));t.touchMove(e(-20,1));t.touchEnd(e(-100,4))
assert.deepEqual(calls,[1],'wide-screen horizontal gesture advances one full group')
assert.equal(t.showPagination.value,true,'actual touch enables indicators even if capability detection misses it')
unmounted.forEach(fn=>fn())
assert.equal(listeners.size,0)
console.log('PASS: actual wide-screen component handlers, 7-card groups, mouse capability, touch fallback and listener cleanup')

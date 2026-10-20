import assert from 'node:assert/strict'
import {startSwipe, moveSwipe, finishSwipe} from './src/components/direction-locked-swipe.js'
const p = (x,y) => ({clientX:x,clientY:y})
function gesture(points) {
  const state=startSwipe(p(0,0))
  for (const [x,y] of points.slice(0,-1)) moveSwipe(state,p(x,y))
  return finishSwipe(state,p(...points.at(-1)),390)
}
assert.equal(gesture([[3,20],[20,150]]),0,'vertical scroll with horizontal drift')
assert.equal(gesture([[15,25],[100,100]]),0,'diagonal movement')
assert.equal(gesture([[2,18],[100,25]]),0,'vertical direction remains locked')
assert.equal(gesture([[20,2],[30,3]]),0,'short horizontal nudge')
assert.equal(gesture([[-20,2],[-90,4]]),1,'left swipe advances one page')
assert.equal(gesture([[20,1],[100,5]]),-1,'right swipe returns one page')
assert.equal(gesture([[20,1],[90,100]]),0,'horizontal start becomes vertical')
assert.equal(gesture([[0,0]]),0,'tap')
assert.equal(finishSwipe(null,p(100,0),390),0,'cancelled or multi-touch gesture')
for (const width of [390, 1280, 1920]) {
  const horizontal = startSwipe(p(0,0))
  moveSwipe(horizontal,p(-20,1))
  assert.equal(finishSwipe(horizontal,p(-100,4),width),1,`page swipe at viewport ${width}`)
  const vertical = startSwipe(p(0,0))
  moveSwipe(vertical,p(3,20))
  assert.equal(finishSwipe(vertical,p(100,150),width),0,`scroll lock at viewport ${width}`)
}
console.log('PASS: direction lock, vertical scroll, diagonal rejection, distance threshold, page swipe, tap and cancellation')

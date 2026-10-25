export function startSwipe(point) {
  return {x: point.clientX, y: point.clientY, direction: null}
}

export function moveSwipe(state, point) {
  if (!state || state.direction) return
  const dx = Math.abs(point.clientX - state.x)
  const dy = Math.abs(point.clientY - state.y)
  // Decide once. Vertical and ambiguous diagonal gestures keep scrolling.
  if (dy >= 10 && dy >= dx * 0.8) state.direction = 'vertical'
  else if (dx >= 14 && dx >= dy * 1.8) state.direction = 'horizontal'
  else if (Math.max(dx, dy) >= 24) state.direction = 'vertical'
}

export function finishSwipe(state, point, width) {
  if (!state) return 0
  moveSwipe(state, point)
  const dx = point.clientX - state.x
  const dy = point.clientY - state.y
  const threshold = Math.min(64, Math.max(42, width * 0.12))
  if (state.direction !== 'horizontal' || Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.8) return 0
  return dx < 0 ? 1 : -1
}

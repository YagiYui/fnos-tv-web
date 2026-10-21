// Flat stroke icons: no rounded caps, raised surfaces, or animation.
const icon = path => `<svg class="fnos-line-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true"><path fill="none" d="${path}"/></svg>`;
export const backIcon = icon('M14 6 8 12l6 6');
export const fullscreenIcon = icon('M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5');
export const fullscreenExitIcon = icon('M4 9h5V4M15 4v5h5M9 20v-5H4M20 15h-5v5');

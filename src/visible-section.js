export function observeSection(element, onVisible, Observer = globalThis.IntersectionObserver) {
  let active = true;
  let observer;
  const show = () => {
    if (!active) return;
    active = false; observer?.disconnect(); onVisible();
  };
  if (typeof Observer === 'function') {
    observer = new Observer(entries => {
      if (entries.some(entry => entry.target === element && entry.isIntersecting)) show();
    }, {rootMargin: '160px 0px', threshold: 0.01});
    observer.observe(element);
  } else show();
  return () => { active = false; observer?.disconnect(); };
}

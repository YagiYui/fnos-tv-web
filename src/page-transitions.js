// Capture the old viewport before Vue commits navigation, then dissolve in the new one.
// The live DOM is never moved, faded, cloned or remounted.
export function installPageTransitions(router, {document, motion, nextTick}) {
  let active;

  function cancel() {
    if (!active) return;
    const previous = active;
    active = undefined;
    previous.cancelled = true;
    previous.allow();
    previous.finish();
    previous.transition?.skipTransition();
    document.documentElement.classList.remove('page-navigation-transition');
  }

  router.beforeResolve((to, from) => {
    cancel();
    if (!document.startViewTransition || motion.matches || document.hidden ||
        !from.name || to.path === '/player' || from.path === '/player' ||
        to.path === '/login' || from.path === '/login' || to.fullPath === from.fullPath) return;

    return new Promise(allow => {
      let finish;
      const committed = new Promise(resolve => { finish = resolve; });
      const entry = {to, allow, finish, cancelled: false};
      active = entry;
      document.documentElement.classList.add('page-navigation-transition');
      try {
        entry.transition = document.startViewTransition(async () => {
          if (entry.cancelled) return;
          allow();
          await committed;
          await nextTick();
        });
        // Unsupported snapshots, backgrounding or a skipped transition must never block routing.
        entry.transition.ready.catch(() => {
          if (active === entry) cancel();
        });
        entry.transition.finished.catch(() => {}).finally(() => {
          if (active === entry) {
            active = undefined;
            document.documentElement.classList.remove('page-navigation-transition');
          }
        });
      } catch {
        cancel();
      }
    });
  });

  router.afterEach((to, from, failure) => {
    if (active?.to !== to) return;
    active.finish();
    if (failure) cancel();
  });
  router.onError(cancel);
  motion.addEventListener('change', cancel);
}

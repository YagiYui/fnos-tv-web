export function isLibraryActive(route, guid) {
  return route.path === '/list' && route.query.scope !== 'favorites' && route.query.gallery_uid === guid;
}
export function libraryViewKey(route) { return route.query.scope === 'favorites' ? '@favorites' : route.query.gallery_uid; }

export function pageBackAction(route, previous) {
  if (route.path === '/list') return {type: 'replace', to: '/'};
  if (typeof previous === 'string' && previous.startsWith('/') && !previous.startsWith('//')) {
    const target = new URL(previous, 'https://fnos.invalid');
    const allowed = ['/', '/list', '/video'].includes(target.pathname);
    const sameItem = target.pathname === '/video' && target.searchParams.get('guid') === route.query?.guid;
    if (allowed && previous !== route.fullPath && !sameItem) return {type: 'back'};
  }
  return {type: 'replace', to: '/'};
}

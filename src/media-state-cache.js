export function invalidateMediaCaches(event, {account, revision, catalogCache, homeLoads, media, libraryViews, browseSnapshots, mediaSearch}) {
  if (!account || String(account) !== event.account || revision !== event.revision) return false;
  catalogCache.clear(); homeLoads.clear(); media.loading = {};
  libraryViews.invalidate(); browseSnapshots.invalidateDetails(); mediaSearch.invalidate();
  // Hide an uncertain badge while authoritative reads run; keep images and page geometry.
  for (const result of Object.values(media.info)) {
    for (const item of result?.list || []) if (item.guid === event.id) {
      if (event.kind === 'watched') { delete item.played; delete item.watched; }
      else delete item.is_favorite;
    }
  }
  for (const item of mediaSearch.state.items) if (item.guid === event.id) {
    if (event.kind === 'watched') delete item.watched;
    else delete item.is_favorite;
  }
  return true;
}

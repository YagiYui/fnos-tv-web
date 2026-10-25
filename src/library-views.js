// Session-only browsing state for the active account. No media enters browser storage.
function copyView(state) {
  return {...state, filters: {...state.filters}, items: [...state.items],
    filterOptions: state.filterOptions ? {genres: state.filterOptions.genres.map(item => ({...item})),
      decades: state.filterOptions.decades.map(item => ({...item}))} : null};
}
export class LibraryViews {
  constructor({limit = 12} = {}) { this.limit = limit; this.account = ''; this.views = new Map(); }
  setAccount(account) {
    const next = String(account ?? '');
    if (next !== this.account) { this.account = next; this.views.clear(); }
  }
  get(account, library) {
    if (!account || String(account) !== this.account) return null;
    const saved = this.views.get(library);
    return saved ? copyView(saved) : null;
  }
  invalidate() {
    for (const [key, saved] of this.views) this.views.set(key, {...saved, hasData: false, items: [], total: null});
  }
  save(account, library, state) {
    if (!account || String(account) !== this.account || !library) return;
    this.views.delete(library);
    this.views.set(library, copyView(state));
    while (this.views.size > this.limit) this.views.delete(this.views.keys().next().value);
  }
}

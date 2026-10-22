// Session-only browsing state for the active account. No media enters browser storage.
export class LibraryViews {
  constructor({limit = 12} = {}) { this.limit = limit; this.account = ''; this.views = new Map(); }
  setAccount(account) {
    const next = String(account ?? '');
    if (next !== this.account) { this.account = next; this.views.clear(); }
  }
  get(account, library) {
    if (!account || String(account) !== this.account) return null;
    const saved = this.views.get(library);
    return saved ? {...saved, items: [...saved.items]} : null;
  }
  save(account, library, state) {
    if (!account || String(account) !== this.account || !library) return;
    this.views.delete(library);
    this.views.set(library, {...state, items: [...state.items]});
    while (this.views.size > this.limit) this.views.delete(this.views.keys().next().value);
  }
}

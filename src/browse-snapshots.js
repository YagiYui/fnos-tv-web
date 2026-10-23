// Small, account-scoped memory snapshots. Never persisted; playback tickets are excluded.
export class BrowseSnapshots {
  constructor({limit = 16} = {}) { this.limit = limit; this.account = ''; this.revision = 0; this.entries = new Map(); }
  setAccount(account) {
    const next = String(account ?? '');
    if (next !== this.account) { this.account = next; this.revision++; this.entries.clear(); }
  }
  get(account, key) {
    if (!account || String(account) !== this.account) return null;
    const value = this.entries.get(key);
    return value ? {...value} : null;
  }
  save(account, key, value, revision = this.revision) {
    if (!account || String(account) !== this.account || revision !== this.revision) return;
    this.entries.delete(key);
    this.entries.set(key, {...value});
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }
}

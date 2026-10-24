// A serial, revision-checked queue. Credentials belong to the injected request closure.
export class PreferenceSync {
  constructor({request, defaults, writeLocal, seed = () => ({}), isCurrent = () => true, onFailure = () => {}}) {
    Object.assign(this, {request, defaults, writeLocal, seed, isCurrent, onFailure});
    this.active = true; this.revision = null; this.initial = null; this.dirty = new Set();
    this.pending = {}; this.pendingReset = false; this.worker = null; this.warned = false;
    this.readController = new AbortController();
  }
  current() { return this.active && this.isCurrent(); }
  warn() { if (this.current() && !this.warned) {this.warned = true; this.onFailure();} }
  async read(apply = false) {
    const result = await this.request('GET', undefined, this.readController.signal);
    if (!this.current()) return false;
    if (result?.schema !== 1 || !Number.isInteger(result.revision) || result.revision<0 || !result.values || typeof result.values !== 'object' || Array.isArray(result.values)) throw new Error('偏好同步返回格式无效');
    this.revision = result.revision;
    if (apply && result.revision === 0 && !Object.keys(result.values).length && !this.pendingReset) {
      const values = Object.fromEntries(Object.entries(this.seed()).filter(([name])=>Object.hasOwn(this.defaults,name)&&!this.dirty.has(name)));
      this.pending = {...values,...this.pending};
      if (Object.keys(values).length) void this.flush();
    }
    if (apply) for (const [name,value] of Object.entries(result.values))
      if (Object.hasOwn(this.defaults,name) && !this.dirty.has(name)) this.writeLocal(name,value);
    return true;
  }
  load() {
    if (!this.initial) this.initial = (async () => {try {return await this.read(true);} catch {this.warn();return false;}})();
    return this.initial;
  }
  save(name,value) {
    if (!this.current() || !Object.hasOwn(this.defaults,name)) return Promise.resolve(false);
    this.dirty.add(name); this.pending[name] = value; return this.flush();
  }
  reset() {
    if (!this.current()) return Promise.resolve(false);
    Object.keys(this.defaults).forEach(name=>this.dirty.add(name));
    this.pending = {}; this.pendingReset = true; return this.flush();
  }
  flush() {
    if (this.worker) return this.worker;
    this.worker = Promise.resolve().then(async()=>{
      let success = true; await this.load();
      while (this.current() && (this.pendingReset || Object.keys(this.pending).length)) {
        const reset = this.pendingReset, values = reset ? {} : this.pending;
        this.pendingReset = false; if (!reset) this.pending = {};
        try {
          if (this.revision === null && !await this.read()) break;
          for (let attempt=0;attempt<2;attempt++) {
            try {
              const expected=this.revision;
              const result = await this.request('PUT', {revision:expected,values,...(reset?{reset:true}:{})});
              if (!this.current()) break;
              if (!Number.isInteger(result?.revision)||result.revision<=expected) throw new Error('偏好同步返回无有效新版本');
              this.revision = result.revision; this.warned = false; break;
            } catch(error) {
              if (error.status === 409 && attempt === 0 && this.current()) {await this.read();continue;}
              throw error;
            }
          }
        } catch { this.revision = null; success = false; this.warn(); }
      }
      return success;
    }).finally(()=>{this.worker = null;if(this.current()&&(this.pendingReset||Object.keys(this.pending).length))void this.flush();});
    return this.worker;
  }
  dispose() {this.active=false;this.readController.abort();this.pending={};this.pendingReset=false;}
}

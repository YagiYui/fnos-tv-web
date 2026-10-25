export async function waitForAssSubtitle(fetchData, isCurrent, {pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeout = 660000, onPending = () => {}} = {}) {
  const started = now();
  let notified = false;
  while (isCurrent()) {
    const data = await fetchData();
    if (!isCurrent()) return null;
    if (!data.pending) return data;
    if (!notified) { onPending(); notified = true; }
    if (now() - started >= timeout) throw new Error('特效字幕仍未准备完成，可继续使用普通字幕，稍后重新选择');
    await pause(Math.min(10000, Math.max(1000, Number(data.retry_after || 3) * 1000)));
  }
  return null;
}

export class SubtitleOverlay {
  constructor({kind = 'ass', load = kind === 'pgs' ? () => import('libbitsub').then(async module => { await module.initWasm(); return module.PgsRenderer; }) : () => import('libass-wasm').then(module => module.default), onFailure = () => {}} = {}) {
    this.kind = kind;
    this.load = load;
    this.onFailure = onFailure;
    this.instance = null;
    this.generation = 0;
    this.cancel = null;
  }
  clear() {
    this.generation++;
    this.cancel?.();
    this.cancel = null;
    this.instance?.dispose();
    this.instance = null;
  }
  async show(video, text, fonts = []) {
    this.clear();
    const generation = this.generation;
    const Renderer = await this.load();
    if (generation !== this.generation) return false;
    return new Promise((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        if (generation !== this.generation || ready) return resolve(false);
        this.cancel = null;
        this.clear();
        reject(new Error('字幕渲染器初始化超时'));
      }, 30000);
      this.cancel = () => { clearTimeout(timeout); resolve(false); };
      const options = {
        video, subContent: text,
        workerUrl: '/vendor/libass/subtitles-octopus-worker.js',
        legacyWorkerUrl: '/vendor/libass/subtitles-octopus-worker-legacy.js',
        fallbackFont: '/vendor/libass/DroidSansFallbackFull.ttf',
        fonts: Array.isArray(fonts) ? fonts : [],
        availableFonts: Array.isArray(fonts) ? {} : fonts,
        targetFps: 24, libassMemoryLimit: 64, libassGlyphLimit: 16,
        onReady: () => {
          clearTimeout(timeout);
          if (generation !== this.generation) return resolve(false);
          ready = true;
          this.cancel = null;
          resolve(true);
        },
        onError: error => {
          clearTimeout(timeout);
          if (generation !== this.generation) return resolve(false);
          const failure = new Error('字幕渲染失败：' + (error?.message || '渲染器不可用'));
          this.cancel = null;
          this.clear();
          if (ready) this.onFailure(failure);
          else reject(failure);
        }
      };
      if (this.kind === 'pgs') {
        options.subContent = undefined;
        options.subUrl = text;
        options.onLoaded = options.onReady;
        options.cacheLimit = 24;
      }
      const instance = new Renderer(options);
      if (generation !== this.generation) { instance.dispose(); return resolve(false); }
      this.instance = instance;
      if (this.kind === 'ass') instance.canvas?.classList.add('fnos-ass-canvas');
      if (instance.canvasParent) {
        instance.canvasParent.style.pointerEvents = 'none';
        instance.canvasParent.style.zIndex = '15';
      }
    });
  }
}

export const AssRenderer = SubtitleOverlay;

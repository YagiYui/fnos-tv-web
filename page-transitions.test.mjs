import test from 'node:test';
import assert from 'node:assert/strict';
import {installPageTransitions} from './src/page-transitions.js';

const route = (path, query = '') => ({name: path, path, fullPath: path + query});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

function fixture() {
  const hooks = {};
  const classes = new Set();
  const captures = [];
  let ticks = 0;
  const document = {
    hidden: false,
    documentElement: {classList: {add: name => classes.add(name), remove: name => classes.delete(name)}},
    startViewTransition(update) {
      const ready = deferred();
      const finished = deferred();
      const capture = {
        update, ready: ready.promise, finished: finished.promise, skipped: false,
        skipTransition() { this.skipped = true; ready.reject(new Error('skipped')); finished.resolve(); },
        finish: finished.resolve,
      };
      captures.push(capture);
      return capture;
    },
  };
  const motion = {matches: false, addEventListener: (_, callback) => { hooks.motion = callback; }};
  installPageTransitions({
    beforeResolve: fn => { hooks.before = fn; },
    afterEach: fn => { hooks.after = fn; },
    onError: fn => { hooks.error = fn; },
  }, {document, motion, nextTick: async () => { ticks++; }});
  return {hooks, document, motion, captures, classes, ticks: () => ticks};
}

test('capture old view before releasing navigation; capture new view after commit and Vue flush', async () => {
  const f = fixture();
  const to = route('/video');
  let allowed = false;
  const navigation = f.hooks.before(to, route('/')).then(() => { allowed = true; });
  await Promise.resolve();
  assert.equal(allowed, false);
  const updated = f.captures[0].update();
  await navigation;
  assert.equal(allowed, true);
  assert.equal(f.ticks(), 0);
  f.hooks.after(to, route('/'));
  await updated;
  assert.equal(f.ticks(), 1);
  f.captures[0].finish();
  await new Promise(setImmediate);
  assert.equal(f.classes.size, 0);
});

test('initial entry, login, player, duplicate navigation and reduced motion bypass capture', () => {
  const f = fixture();
  for (const [to, from] of [
    [route('/'), {path: '/', fullPath: '/'}],
    [route('/player'), route('/video')],
    [route('/video'), route('/player')],
    [route('/player', '?episode=2'), route('/player', '?episode=1')],
    [route('/login'), route('/')],
    [route('/'), route('/login')],
    [route('/'), route('/')],
  ]) assert.equal(f.hooks.before(to, from), undefined);
  f.motion.matches = true;
  assert.equal(f.hooks.before(route('/video'), route('/')), undefined);
  assert.equal(f.captures.length, 0);
});

test('unsupported API, background tab and synchronous API failure cannot block navigation', async () => {
  const f = fixture();
  f.document.hidden = true;
  assert.equal(f.hooks.before(route('/video'), route('/')), undefined);
  f.document.hidden = false;
  f.document.startViewTransition = undefined;
  assert.equal(f.hooks.before(route('/video'), route('/')), undefined);
  f.document.startViewTransition = () => { throw new Error('unavailable'); };
  await f.hooks.before(route('/video'), route('/'));
  assert.equal(f.classes.size, 0);
});

test('rapid navigation releases and skips previous capture without clearing the new one', async () => {
  const f = fixture();
  const first = f.hooks.before(route('/video'), route('/'));
  const second = f.hooks.before(route('/list'), route('/'));
  await first;
  await new Promise(setImmediate);
  assert.equal(f.captures[0].skipped, true);
  assert.equal(f.classes.size, 1);
  f.hooks.error();
  await second;
  assert.equal(f.classes.size, 0);
});

test('failed navigation, snapshot rejection and motion changes release waiting callbacks', async () => {
  for (const reason of ['failure', 'snapshot', 'motion']) {
    const f = fixture();
    const to = route('/video');
    const navigation = f.hooks.before(to, route('/'));
    const capture = f.captures[0];
    const updated = capture.update();
    await navigation;
    if (reason === 'failure') f.hooks.after(to, route('/'), new Error('cancelled'));
    if (reason === 'snapshot') capture.skipTransition();
    if (reason === 'motion') f.hooks.motion();
    await updated;
    await new Promise(setImmediate);
    assert.equal(f.classes.size, 0);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural guardrails for the hand-authored render tree.
//
// Motivation: every one of these regressed at least once during development and
// was only caught by a user screenshot — a button that fell out of `nav` and
// shifted the 5-column grid, a button rendered with no label because a locale key
// was missing, and a dictionary that had a key in one language only. `node
// --check` cannot see any of them, so they are asserted here instead.

const SOURCE_PATH = new URL('../src/client.js', import.meta.url);
const source = readFileSync(SOURCE_PATH, 'utf8');

// ── Harness: load the client factory with stub React/slots ───────────────────
function loadClient(view = {}) {
  const h = (tag, props, ...kids) => {
    if (typeof tag === 'function') {
      if (tag.prototype && tag.prototype.render) {
        const instance = Object.create(tag.prototype);
        instance.props = { ...(props ?? {}), children: kids };
        instance.state = { error: '' };
        return instance.render();
      }
      return tag({ ...(props ?? {}), ...(kids.length ? { children: kids } : {}) });
    }
    return { tag, props: props ?? {}, kids };
  };
  class Component {}
  class Boundary extends Component {
    render() {
      return this.state.error ? { tag: 'div', props: {}, kids: [String(this.state.error)] } : this.props.children;
    }
  }
  const stores = [];
  let index = 0;
  const useState = (initial) => {
    const slot = index;
    index += 1;
    stores[slot] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [stores[slot].value, (next) => {
      stores[slot].value = typeof next === 'function' ? next(stores[slot].value) : next;
    }];
  };
  const React = { createElement: h, Fragment: 'F', Component, useState, useEffect: () => {}, useRef: (v) => ({ current: v }) };
  const dictionaries = [];
  const registrations = [];
  const stubs = { localStorage: undefined };
  globalThis.localStorage = {
    getItem: (key) => key === 'dcc-inv-view' ? JSON.stringify(view) : null,
    setItem: () => {},
  };
  globalThis.window = { __ModuleLoader__: { load: (definition) => { stubs.definition = definition; } } };

  // The module registers itself on import; do it through a fresh evaluation.
  const factory = new Function('window', `${source}\nreturn window.__ModuleLoader__;`);
  const loader = factory(globalThis.window) ?? globalThis.window.__ModuleLoader__;
  const definition = stubs.definition ?? loader.__last;
  const module = definition.factory((name) => (name === 'react' ? React : {}));
  const ctx = {
    effect: (callback) => { callback(); },
    locale: {
      register: (_namespace, dicts) => { dictionaries.push(dicts); },
      bind: () => (key) => key,
    },
    connection: { rpc: { call: async () => ({ ok: true, value: { ok: true, items: [] } }) } },
    slots: {
      register: (options, render) => { registrations.push({ options, render }); return () => {}; },
      inject: () => () => {},
    },
    get: () => undefined,
  };
  module.apply(ctx);
  return { dictionaries: dictionaries[0], registrations, index: () => index };
}

// ── Dictionary parity ────────────────────────────────────────────────────────
test('every literal t() key exists in BOTH dictionaries', () => {
  const { dictionaries } = loadClient();
  assert.ok(dictionaries, 'the client registered its dictionaries');
  const literalKeys = new Set([...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'\)/g)].map((m) => m[1]));
  assert.ok(literalKeys.size > 50, `found ${literalKeys.size} literal keys`);
  const missing = { en: [], zh: [] };
  for (const locale of ['en', 'zh']) {
    for (const key of literalKeys) {
      if (!Object.hasOwn(dictionaries[locale], key)) missing[locale].push(key);
    }
  }
  assert.deepEqual(missing.en, [], `en is missing: ${missing.en.join(', ')}`);
  assert.deepEqual(missing.zh, [], `zh is missing: ${missing.zh.join(', ')}`);
});

test('en and zh define the same key set', () => {
  const { dictionaries } = loadClient();
  const en = Object.keys(dictionaries.en).sort();
  const zh = Object.keys(dictionaries.zh).sort();
  assert.deepEqual(en.filter((key) => !zh.includes(key)), [], 'keys only in en');
  assert.deepEqual(zh.filter((key) => !en.includes(key)), [], 'keys only in zh');
});

// ── Render tree invariants ───────────────────────────────────────────────────
test('sidebar bridge icon respects host sizing and inherits navigation color', () => {
  const { registrations } = loadClient();
  const entry = registrations.find((item) => item.options.name === 'sidebar.panellist');
  assert.equal(entry.options.id, 'claude-compat');
  for (const size of [16, 20]) {
    for (const active of [false, true]) {
      const icon = entry.render({ size, active });
      assert.equal(icon.tag, 'svg');
      assert.equal(icon.props.width, size);
      assert.equal(icon.props.height, size);
      assert.equal(icon.props.viewBox, '0 0 24 24');
      assert.equal(icon.props.fill, 'none');
      assert.equal(icon.props.stroke, 'currentColor');
      assert.equal(icon.props.strokeWidth, 2);
      assert.equal(icon.props.strokeLinecap, 'round');
      assert.equal(icon.props.strokeLinejoin, 'round');
      assert.equal(icon.props['aria-hidden'], 'true');
      assert.ok(icon.kids.every((child) => child.tag === 'path'), 'link uses vector paths, not text or disconnected boxes');
    }
  }
});

test('the inventory page keeps a 5-child grid in order', () => {
  const { registrations } = loadClient();
  const main = registrations.find((entry) => entry.options.name === 'main');
  assert.ok(main, 'main slot registered');
  const tree = main.render({});
  const grid = findNode(tree, (node) => node?.props?.className === 'dcc-inv');
  assert.ok(grid, 'the grid renders');
  const children = grid.kids.map((kid) => kid?.props?.className ?? kid?.tag);
  assert.deepEqual(children.filter(Boolean),
    ['dcc-inv-nav', 'dcc-inv-split', 'dcc-inv-list', 'dcc-inv-split', 'dcc-inv-detail'],
    'the closed viewer leaves exactly five grid children in their column order');
});

test('no button renders without a visible label', () => {
  const { registrations } = loadClient();
  const main = registrations.find((entry) => entry.options.name === 'main');
  const tree = main.render({});
  const offenders = [];
  walk(tree, (node) => {
    // `Button` is a wrapper component, so its nodes are functions, not 'button'.
    const isButton = node?.tag === 'button' || (typeof node?.tag === 'function' && node.tag.name === 'Button');
    if (!isButton) return;
    const text = flatten(node.kids).join('').trim();
    if (text === '') offenders.push(node.props?.['aria-label'] ?? '(no aria-label)');
  });
  assert.deepEqual(offenders, [], 'a missing locale key produced a blank button');
});

test('inventory search runs as you type and has no confirm button', () => {
  const { registrations } = loadClient();
  const main = registrations.find((entry) => entry.options.name === 'main');
  const tree = main.render({});
  const inputs = [];
  const buttons = [];
  walk(tree, (node) => {
    const cls = typeof node?.props?.className === 'string' ? node.props.className : '';
    if (node?.tag === 'input' && node.props?.type === 'search') inputs.push(node.props);
    if (node?.tag === 'button') buttons.push(flatten(node.kids).join(''));
    if (cls.includes('dcc-inv-filters')) buttons.push('FILTER-BAR');
  });
  assert.equal(inputs.length, 1, 'exactly one search box');
  // The placeholder advertises live search instead of an apply step.
  assert.equal(inputs[0].placeholder, 'searchAsYouType');
  assert.deepEqual(buttons.filter((label) => label === 'find'), [], 'no submit-to-search button remains');
  // Nothing is filtered initially, so the chip bar stays out of the way.
  assert.deepEqual(buttons.filter((label) => label === 'FILTER-BAR'), []);
});

test('an active filter is shown with its own clear action', () => {
  // The chip bar is driven by state, so exercise its descriptor logic directly:
  // every filter that can empty the list must appear in one removable list.
  const source = readFileSync(SOURCE_PATH, 'utf8');
  for (const key of ['search !== \'\'', 'source !== \'\'', 'drillActive &&']) {
    assert.ok(source.includes(key), `active-filter list covers ${key}`);
  }
  assert.ok(source.includes('clearAllFilters'), 'there is a clear-all action');
});

test('plugin drill-down shows one removable condition and no redundant clear-all', () => {
  for (const withSearch of [false, true]) {
    const { registrations } = loadClient({
      kind: 'agent', pluginFilter: { key: 'caveman@market', name: 'caveman', forKind: 'agent' },
      query: withSearch ? 'review' : '', search: withSearch ? 'review' : '',
    });
    const tree = registrations.find((entry) => entry.options.name === 'main').render({});
    const text = flatten(tree).join(' ');
    assert.equal(text.split('caveman').length - 1, 1, 'plugin condition is displayed once');
    assert.equal(text.includes('clearFilters'), withSearch, 'clear-all only helps when multiple conditions apply');
    const chip = findNode(tree, (node) => node.props?.className === 'dcc-filter-chip'
      && flatten(node).join('').includes('caveman'));
    assert.equal(typeof chip?.props.onClick, 'function', 'the single condition remains removable');
    assert.equal(findNode(tree, (node) => node.props?.className === 'dcc-inv-filterbar'), undefined);
  }
});

test('translation task is restored on reopening and repeated clicks do not start another job', async () => {
  const body = source.slice(source.indexOf('        function useTranslationTask('), source.indexOf('        function FileViewer('));
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, timerId = 0, starts = 0;
  let delayNextList = false, resolveList;
  let job = null;
  const pendingJob = (value) => ['running', 'queued'].includes(value.state);
  const api = async (request) => {
    if (request.action === 'operation.list') {
      if (delayNextList) {
        delayNextList = false;
        return new Promise((resolve) => { resolveList = resolve; });
      }
      return { items: job ? [job] : [] };
    }
    if (request.action === 'operation.status') return job;
    if (request.action === 'operation.start') {
      starts++;
      job = { id: 'job-1', action: 'inventory.translate', itemId: 'rule:a', cwd: '/project', lang: 'zh',
        state: 'running', createdAt: Date.now(), translationProgress: { completed: 0, total: 2, backend: 'model' } };
      return job;
    }
    assert.fail(`unexpected request: ${request.action}`);
  };
  const useState = (initial) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
  };
  const useRef = (initial) => {
    const i = cursor++;
    slots[i] ??= { current: initial };
    return slots[i];
  };
  const useEffect = (run, deps) => {
    const i = cursor++;
    const old = slots[i];
    if (!old || deps.some((d, n) => d !== old.deps[n])) {
      old?.cleanup?.();
      slots[i] = { deps };
      effects.push(() => { slots[i].cleanup = run(); });
    }
  };
  const hook = new Function('useState', 'useEffect', 'useRef', 'api', 'pendingJob', 'setTimeout', 'clearTimeout',
    `${body}\nreturn useTranslationTask;`)(useState, useEffect, useRef, api, pendingJob,
    (callback) => { timers.set(++timerId, callback); return timerId; }, (id) => timers.delete(id));
  const render = (enabled = true) => {
    cursor = 0;
    const value = hook({ enabled, itemId: 'rule:a', cwd: '/project', lang: 'zh' });
    effects.splice(0).forEach((run) => run());
    return value;
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const poll = async () => {
    const callbacks = [...timers.values()]; timers.clear();
    callbacks.forEach((run) => run());
    await settle();
  };
  try {
    assert.equal(render().checking, true, 'check the host before enabling translation');
    await settle();
    let task = render();
    assert.equal(task.checking, false);
    delayNextList = true;
    await poll(); // This older list request remains pending while start resolves.
    await Promise.all([task.start(), task.start()]);
    assert.equal(starts, 1, 'same-tick double click starts one operation');
    resolveList({ items: [] });
    await settle();
    assert.equal(render().job.id, 'job-1', 'a stale pre-start poll cannot erase the new running job');
    render(false);
    render(true);
    await settle();
    task = render();
    assert.equal(task.job.id, 'job-1', 'reopening reattaches to the original host job');
    await task.start(true);
    assert.equal(starts, 1, 'even force cannot start a second running task');
    job = { ...job, translationProgress: { completed: 1, total: 2, backend: 'model' } };
    await poll();
    assert.equal(render().job.translationProgress.completed, 1);
    job = { ...job, state: 'done', result: { ok: true, content: '译文', backend: 'model' } };
    await poll();
    assert.equal(render().job.result.content, '译文', 'the completed result is delivered without another start');
  } finally { render(false); }
});

test('the viewer disables translation while restoring or running a task and displays progress', () => {
  const body = source.slice(source.indexOf('        function FileViewer('), source.indexOf('        function InvDetail('));
  const h = (tag, props, ...kids) => typeof tag === 'function'
    ? tag({ ...props, children: kids }) : { tag, props: props ?? {}, kids };
  const button = (props) => h('button', props, props.children);
  const viewer = new Function('h', 'Button', 'Notice', 't', 'formatBytes', 'useRef', 'useEffect', `${body}\nreturn FileViewer;`)(
    h, button, () => null, (key) => key, () => '1 KB', () => ({ current: null }), () => {});
  const tree = viewer({ view: { name: 'a', path: '/a', data: { content: 'source', bytes: 1, mtime: 0 },
    translating: true, checkingTranslation: false, translationProgress: { completed: 1, total: 3 }, elapsedSeconds: 20 },
    onClose() {}, onReload() {}, onTranslate() {}, targetLanguage: () => 'zh' });
  const translate = findNode(tree, (node) => node.tag === 'button' && flatten(node).join('').includes('translate'));
  assert.equal(translate.props.disabled, true);
  const progress = findNode(tree, (node) => node.tag === 'progress');
  assert.equal(progress.props.value, 1);
  assert.equal(progress.props.max, 3);
  assert.ok(flatten(tree).join('').includes('20s'));
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function findNode(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of [].concat(node.kids ?? [])) {
    const hit = findNode(child, predicate);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function walk(node, visit) {
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of [].concat(node.kids ?? [])) walk(child, visit);
}

// Collect every string leaf, recursing through nested arrays: label text sits in
// `kids: [['Back']]` shape after React children flattening.
function flatten(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return out;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  flatten(node.kids ?? [], out);
  return out;
}

// Functional component harness: real React/test-renderer, no DOM or visual claims.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createCompatibilityService } from '../src/compat-service.js';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function historyMetadata(metadata) {
  // A metadata-only adapter must not manufacture or lazily fetch transcript text.
  return Object.defineProperty({ ...metadata }, 'text', {
    get() { throw new Error('component handoff must not access transcript text'); },
  });
}
export function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node) return '';
  return (node.children ?? []).map(text).join('');
}
function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}
export async function clientHarness(t, options = {}) {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const slots = new Map(), dictionaries = new Map(), cleanups = [];
  const requests = [], mutations = [], gates = new Map();
  let tree, definition, listReads = 0, invalidations = 0;
  const items = options.pluginItems ?? ['A', 'B', 'C'].map((name) => ({ name, marketplace: 'catalog', enabled: true, version: '1',
    operationTarget: `${name}@catalog`, capabilities: { enable: true, disable: true, update: true, uninstall: true } }));
  const host = { get: (name) => options.hostServices?.[name] };
  const service = createCompatibilityService(host, { userClaudeDir: '/__dcc_component_fixture__' }, () => invalidations++, {
    ...(options.sessionService ? { sessionService: options.sessionService } : {}),
    pluginOperation: async (request, { signal, onProgress }) => {
      if (['list', 'search', 'marketplace-list'].includes(request.action)) return {
        ok: true, action: request.action, items: request.action === 'marketplace-list' ? options.marketplaceItems ?? items : items,
      };
      mutations.push({ ...request, signal });
      if (options.immediate) return { ok: true, action: request.action };
      const gate = deferred();
      const abort = () => gate.reject(new Error('fixture operation cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      gates.set(request.target, { ...gate, signal });
      onProgress({ phase: mutations.length === 1 ? 'running' : 'queued' });
      try { return await gate.promise; }
      finally { signal.removeEventListener('abort', abort); }
    },
  });
  const backend = {
    service, mutations,
    complete(target, result = { ok: true }) { const gate = gates.get(target); assert.ok(gate, `operation ${target} has started`); gate.resolve(result); },
    get invalidations() { return invalidations; },
    snapshot: () => service.call({ action: 'operation.list' }),
  };
  const scope = {
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    locale: {
      register(namespace, values) { dictionaries.set(namespace, values); return () => dictionaries.delete(namespace); },
      bind(namespace) { return (key) => dictionaries.get(namespace)?.en[key] ?? key; },
    },
    slots: {
      inject(_owner, callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
      register(entry, component) {
        const key = `${entry.name}:${entry.id ?? entry.key}`;
        slots.set(key, component);
        return () => slots.delete(key);
      },
    },
    connection: { rpc: { async call(channel, endpoint, payload, signal) {
      assert.equal(channel, '/api'); assert.equal(endpoint, 'claude-compat');
      requests.push(structuredClone(payload));
      const next = () => payload.action === 'status'
        ? Promise.resolve({ ok: true, cwd: '/fixture-project', version: 'fixture', features: {}, nativeSessions: true, ...options.status })
        : service.call(payload, signal);
      const ordinal = payload.action === 'operation.list' ? ++listReads : 0;
      try {
        const value = await abortable(Promise.resolve(options.rpc ? options.rpc({ payload, ordinal, next, backend }) : next()), signal);
        return { ok: true, value };
      } catch (error) { return { ok: false, error: { message: error.message } }; }
    } } },
    get(name) { return options.services?.[name]; },
  };
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
    crypto: globalThis.crypto, AbortController, console,
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
  }, { filename: 'src/client.js' });
  assert.equal(definition.id, 'dsh-claude-compat');
  const module = definition.factory((name) => { assert.equal(name, 'react'); return React; });
  module.apply(scope);
  const Manager = slots.get('plugins.tab:claude-compat');
  assert.equal(typeof Manager, 'function');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  async function flush() { await act(async () => {}); }
  async function render(command) {
    let component = Manager;
    let props = { initialCwd: options.initialCwd ?? '/fixture-project' };
    if (command) {
      component = slots.get('conversation.chat.commandview:cc-resume');
      assert.equal(typeof component, 'function');
      props = { sessionId: command.sessionId ?? 'current-A', node: {
        kind: 'command', seq: 1, time: Date.now(), commandId: 'fixture-resume-command', name: 'cc-resume', args: '',
        outcome: { kind: 'success', text: JSON.stringify({ ui: 'claude-compat', mode: 'sessions', cwd: command.cwd ?? options.initialCwd ?? '/fixture-project' }) },
      } };
    }
    await act(async () => { tree = TestRenderer.create(React.createElement(component, props)); });
    await flush();
  }
  // A separate shell mount lets regression tests model native slot gating rather
  // than mounting a command renderer that the native blank conversation omits.
  async function mount(element) {
    await act(async () => { tree = TestRenderer.create(element); });
    await flush();
  }
  async function updateTree(element) {
    assert.ok(tree, 'a shell is mounted before updating its session');
    await act(async () => { tree.update(element); });
    await flush();
  }
  async function unmount() {
    if (tree) await act(async () => { tree.unmount(); tree = undefined; });
  }
  const rows = () => tree.root.findAll((node) => node.type === 'li'
    && ['dcc-row', 'dcc-session-item'].some((name) => String(node.props.className).split(' ').includes(name)));
  function row(name) {
    const value = rows().find((node) => node.findAll((child) => ['div', 'span'].includes(child.type) && child.props.className === 'dcc-title').some((title) => text(title) === name));
    assert.ok(value, `visible item row ${name}`);
    return value;
  }
  function button(root, label) {
    const found = root.findAll((node) => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
    assert.equal(found.length, 1, `one button labeled ${label}`);
    return found[0];
  }
  async function click(node) {
    assert.notEqual(node.props.disabled, true, `button ${text(node)} must be enabled`);
    await act(async () => { node.props.onClick(); }); await flush();
  }
  async function change(node, value) { await act(async () => { node.props.onChange({ target: { value } }); }); await flush(); }
  async function submitInput(label, value) {
    const input = () => tree.root.findAll((node) => node.type === 'input' && node.props['aria-label'] === label)[0];
    assert.ok(input(), `input labeled ${label}`);
    await change(input(), value);
    let form = input().parent;
    while (form && form.type !== 'form') form = form.parent;
    assert.ok(form, 'the input belongs to a real form');
    const submit = form.findAll((node) => node.type === 'button' && node.props.type === 'submit');
    assert.equal(submit.length, 1);
    assert.notEqual(submit[0].props.disabled, true, 'another item task must not disable this form');
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
    await flush();
  }
  async function advance(milliseconds) { await act(async () => { t.mock.timers.tick(milliseconds); }); await flush(); }
  t.after(async () => {
    if (tree) await act(async () => { tree.unmount(); tree = undefined; });
    await service.dispose();
    for (const cleanup of cleanups.reverse()) cleanup();
    t.mock.timers.reset();
  });
  return {
    backend, requests, render, mount, updateTree, unmount, slot: (name, key) => slots.get(`${name}:${key}`),
    flush, advance, rows, row, button, click, change, submitInput,
    root: () => tree.root,
    states: (name) => row(name).findAll((node) => node.type === 'span' && node.props.role === 'status').map(text),
    alerts: (name) => row(name).findAll((node) => node.props.role === 'alert').map(text),
    reads: (action) => requests.filter((request) => request.action === action),
  };
}

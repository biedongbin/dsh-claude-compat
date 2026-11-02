// Test kit for the hook bridges: a fake DSH context that keeps every listener of an
// event, and composes waterfall listeners the way Cordis does (each listener
// receives `next` for the listener after it).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from '../src/hooks.js';

export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

// A hook command that prints a JSON object. The JSON must not contain a single quote.
export const say = (value) => `printf '%s' '${JSON.stringify(value)}'`;

export const textOf = (message) => message.content[0].text;

export async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

export async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { value: await fn(warnings), warnings };
  } finally {
    console.warn = original;
  }
}

export function fakeAgent(id = 'sess-1', cwd = '/work') {
  const agent = {
    session: { id, header: { id, cwd } },
    injected: [],
    steered: [],
    inject: (message) => agent.injected.push(message),
    steer: (message) => agent.steered.push(message),
  };
  return agent;
}

/**
 * Register hooks from a settings object against a fake context.
 * `dispatch(name, args, terminal)` runs every listener of `name` as a waterfall,
 * then calls `terminal` for the decision that DSH itself would reach.
 */
export function harness(hooks, options = {}) {
  const dir = tempDir('dcc-kit-');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks }));
  const listeners = new Map();
  const effects = [];
  const ctx = {
    on: (name, fn) => listeners.set(name, [...listeners.get(name) ?? [], fn]),
    effect: (setup) => effects.push(setup()),
    ...options.ctx,
  };
  registerHooks(ctx, { userClaudeDir: dir, projectRootMarkers: ['.git'], hooksTimeoutMs: 5000 }, { runners: options.runners });
  return {
    has: (name) => listeners.has(name),
    drain: () => Promise.all(effects.map((drain) => drain())),
    dispatch(name, args, terminal) {
      const chain = listeners.get(name) ?? [];
      const step = (index) => (index >= chain.length ? terminal() : chain[index](...args, () => step(index + 1)));
      return step(0);
    },
  };
}

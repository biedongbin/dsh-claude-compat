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

// The DSH events that are waterfalls: each listener gets `next` for the listener after it.
const WATERFALLS = new Set(['tools/pre-execute', 'tools/post-execute', 'agent/pre-step', 'approval/request', 'user-questions/request']);

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
    effect: (setup, name) => effects.push({ name, teardown: setup() }),
    ...options.ctx,
  };
  const hooksApi = registerHooks(
    ctx,
    { userClaudeDir: dir, projectRootMarkers: ['.git'], hooksTimeoutMs: 5000 },
    { runners: options.runners, intervalMs: options.intervalMs ?? 20 },
  );
  return {
    dir,
    instructionsLoaded: hooksApi.instructionsLoaded,
    engine: hooksApi.engine,
    has: (name) => listeners.has(name),
    // Wait for the hook runs that are still going. Other effects, such as file watches, stay on.
    drain: () => Promise.all(effects.filter((e) => /drain hook runs/.test(e.name)).map((e) => e.teardown())),
    // Run every teardown, as plugin unload does.
    dispose: () => Promise.all(effects.map((e) => e.teardown())),
    dispatch(name, args, terminal) {
      const chain = listeners.get(name) ?? [];
      if (!WATERFALLS.has(name)) {
        // A serial or emit event: every listener runs, one after another, and none gets `next`.
        return (async () => {
          let last;
          for (const listener of chain) last = await listener(...args);
          return last ?? terminal();
        })();
      }
      const step = (index) => (index >= chain.length ? terminal() : chain[index](...args, () => step(index + 1)));
      return step(0);
    },
  };
}

/** An agent that DSH created for a subagent run. */
export function fakeSubagent(id = 'sub-1', parent = 'sess-1') {
  const agent = fakeAgent(id);
  agent.session.header.origin = 'subagent';
  agent.session.header.parentSession = parent;
  return agent;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import { registerManagerCommands } from '../src/commands.js';
import { apply } from '../src/index.js';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dcc-manager-'));
  const old = join(root, 'header project'), effective = join(root, 'effective project');
  for (const [cwd, body] of [[old, 'OLD_HEADER_BODY'], [effective, 'EFFECTIVE_SKILL_BODY']]) {
    await mkdir(join(cwd, '.git'), { recursive: true });
    await mkdir(join(cwd, '.dsh', 'skills', 'fixture-skill'), { recursive: true });
    await writeFile(join(cwd, '.dsh', 'skills', 'fixture-skill', 'SKILL.md'), `---\nname: fixture-skill\ndescription: Fixture export\n---\n\n${body}\n`);
  }
  const ctx = new Context(), definitions = new Map(), requests = [];
  let invalidations = 0;
  const control = { invalidate() { assert.equal(this, control); invalidations += 1; } };
  ctx.provide('commands', { register(definition) { definitions.set(definition.name, definition); } });
  ctx.provide('workingDirectory', { get(session) {
    if (options.cwdError) throw new Error(options.cwdError);
    assert.equal(session.header.cwd, old);
    return effective;
  } });
  if (options.subprocess) ctx.provide('subprocess', options.subprocess);
  const manager = { async execute(request, signal) {
    requests.push({ request: structuredClone(request), signal });
    return options.execute ? options.execute(request, signal) : { ok: true, action: request.action };
  } };
  await ctx.plugin((scope) => registerManagerCommands(scope, {}, options.getProvider ?? (() => ({ control })), manager));
  await turn();
  const agent = { id: 'current-dsh', session: { id: 'current-dsh', header: { cwd: old } } };
  const invoke = (name, rawInput = '', receivingAgent = agent, signal = new AbortController().signal) => {
    assert.ok(definitions.has(name), `registered ${name}`);
    return definitions.get(name).handler({ agent: receivingAgent, rawInput, signal });
  };
  t.after(async () => {
    await ctx.fiber.dispose();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dcc-manager-'));
    await rm(root, { recursive: true, force: true });
  });
  return { root, old, effective, ctx, definitions, requests, invoke, agent, invalidations: () => invalidations };
}

test('the exact native command set is registered and empty managers never invoke an operation', async (t) => {
  const f = await fixture(t);
  assert.deepEqual([...f.definitions.keys()].sort(), ['cc-export', 'cc-plugin', 'cc-resume', 'reload-cc-plugins', 'reload-skills']);
  for (const input of ['', 'pick']) {
    const result = await f.invoke('cc-resume', input);
    assert.equal(result.kind, 'success');
    assert.deepEqual(JSON.parse(result.text), { ui: 'claude-compat', mode: 'sessions', cwd: f.effective, targetSessionId: f.agent.id });
  }
  assert.deepEqual(JSON.parse((await f.invoke('cc-plugin')).text), { ui: 'claude-compat', mode: 'plugins', cwd: f.effective });
  assert.equal(f.requests.length, 0);
});

test('resume list, current-session aliases and explicit archive preserve their separate meanings', async (t) => {
  const f = await fixture(t), source = join(f.root, 'selected source');
  await f.invoke('cc-resume', 'list');
  assert.deepEqual(f.requests.at(-1).request, { action: 'sessions.list', cwd: f.effective, limit: 10 });
  for (const verb of ['resume', 'import']) {
    await f.invoke('cc-resume', `${verb} claude-source --cwd "${source}" --limit-turns 50`);
    assert.deepEqual(f.requests.at(-1).request, { action: 'sessions.resume', cwd: source, sessionId: 'claude-source', limitTurns: 50, targetSessionId: 'current-dsh' });
  }
  await f.invoke('cc-resume', `archive claude-source --cwd "${source}" --limit-turns 200 --new-snapshot`);
  assert.deepEqual(f.requests.at(-1).request, { action: 'sessions.import', cwd: source, sessionId: 'claude-source', limitTurns: 200, newSnapshot: true });
  const outcome = await f.invoke('cc-resume', 'resume claude-source', { session: { id: 'fallback-session', header: { cwd: f.old } } });
  assert.equal(outcome.kind, 'success');
  assert.equal(f.requests.at(-1).request.targetSessionId, 'fallback-session');
  assert.equal((await f.invoke('cc-resume', 'resume claude-source', { session: { header: { cwd: f.old } } })).kind, 'error');
});

test('plugin parser executes documented actions, marketplace aliases and shorthand with effective cwd', async (t) => {
  const f = await fixture(t);
  const cases = [
    ['list', { action: 'plugins.list' }],
    ['search "two words"', { action: 'plugins.search', query: 'two words' }],
    ['install fixture@catalog', { action: 'plugins.install', target: 'fixture@catalog' }],
    ['fixture@catalog', { action: 'plugins.install', target: 'fixture@catalog' }],
    ['remove fixture@catalog', { action: 'plugins.uninstall', target: 'fixture@catalog' }],
    ['enable fixture@catalog', { action: 'plugins.enable', target: 'fixture@catalog' }],
    ['disable fixture@catalog', { action: 'plugins.disable', target: 'fixture@catalog' }],
    ['update fixture@catalog', { action: 'plugins.update', target: 'fixture@catalog' }],
    ['update', { action: 'plugins.update' }],
    ['marketplace list', { action: 'plugins.marketplace-list' }],
    ['marketplace add owner/repository', { action: 'plugins.marketplace-add', target: 'owner/repository' }],
    ['marketplace rm catalog', { action: 'plugins.marketplace-remove', target: 'catalog' }],
    ['marketplace update catalog', { action: 'plugins.marketplace-update', target: 'catalog' }],
  ];
  for (const [input, expected] of cases) {
    assert.equal((await f.invoke('cc-plugin', input)).kind, 'success');
    assert.deepEqual(f.requests.at(-1).request, { ...expected, cwd: f.effective });
  }
});

test('business errors, thrown operations and effective-directory failures return command errors', async (t) => {
  const f = await fixture(t, { execute: async (request) => {
    if (request.action === 'plugins.search') throw new Error('fixture query unavailable');
    return { ok: false, error: 'fixture authentication failure' };
  } });
  assert.match((await f.invoke('cc-plugin', 'update fixture@catalog')).text, /authentication failure/);
  assert.equal((await f.invoke('cc-plugin', 'update')).kind, 'error');
  assert.match((await f.invoke('cc-plugin', 'search term')).text, /query unavailable/);
  const broken = await fixture(t, { cwdError: 'effective directory unavailable' });
  for (const command of ['cc-resume', 'cc-plugin', 'cc-export']) {
    const outcome = await broken.invoke(command);
    assert.equal(outcome.kind, 'error');
    assert.match(outcome.text, /effective directory unavailable/);
  }
  assert.equal(broken.requests.length, 0);
});

test('both reload aliases await real invalidation and preserve its failure', async (t) => {
  const f = await fixture(t);
  for (const name of ['reload-cc-plugins', 'reload-skills']) assert.equal((await f.invoke(name)).kind, 'success');
  assert.equal(f.invalidations(), 2);
  const broken = await fixture(t, { getProvider: () => ({ control: { invalidate: async () => { throw new Error('fixture cache failed'); } } }) });
  for (const name of ['reload-cc-plugins', 'reload-skills']) {
    const outcome = await broken.invoke(name);
    assert.equal(outcome.kind, 'error'); assert.match(outcome.text, /cache failed/);
  }
  const absent = await fixture(t, { getProvider: () => undefined });
  assert.equal((await absent.invoke('reload-skills')).kind, 'error');
});

async function inlineProvider(t, invalidate) {
  const f = await fixture(t), lifetime = new AbortController();
  let provider;
  const control = { signal: lifetime.signal, ...(invalidate ? { invalidate } : {}) };
  apply({ skills: { registerProvider(factory) { provider = factory(control); } } }, {
    userClaudeDir: join(f.root, 'isolated Claude config'), enablePluginManager: false,
    enableMcp: false, enableHooks: false, enableRules: false, enableStarNudge: false,
  });
  t.after(() => lifetime.abort());
  assert.ok(provider);
  return { provider, control };
}

test('inline reload skill aliases await asynchronous provider invalidation before returning success text', async (t) => {
  let invalidations = 0;
  const f = await inlineProvider(t, async function () {
    assert.equal(this, f.control);
    await Promise.resolve(); invalidations += 1;
  });
  for (const name of ['reload-cc-plugins', 'reload-skills']) {
    const receipt = await f.provider.get(f.provider.reloadSkillDef(name, 'fixture reload'));
    assert.equal(receipt.name, name);
    assert.match(receipt.content, /cache was just dropped/);
  }
  assert.equal(invalidations, 2);
});

test('inline reload aliases propagate synchronous and asynchronous invalidation failures', async (t) => {
  for (const invalidate of [() => { throw new Error('fixture inline cache failure'); }, async () => { throw new Error('fixture inline cache failure'); }]) {
    const f = await inlineProvider(t, invalidate);
    for (const name of ['reload-cc-plugins', 'reload-skills']) {
      await assert.rejects(f.provider.get(f.provider.reloadSkillDef(name, 'fixture reload')), /fixture inline cache failure/);
    }
  }
});

test('inline reload aliases refuse unavailable refresh controls', async (t) => {
  const f = await inlineProvider(t);
  for (const name of ['reload-cc-plugins', 'reload-skills']) {
    await assert.rejects(f.provider.get(f.provider.reloadSkillDef(name, 'fixture reload')), /refresh control is unavailable/);
  }
});

test('real registration failures are surfaced while hosts without injection remain supported', () => {
  const manager = { execute() { throw new Error('unused'); } };
  assert.doesNotThrow(() => registerManagerCommands({}, {}, () => undefined, manager));
  assert.throws(() => registerManagerCommands({ inject() { throw new Error('registration failed'); } }, {}, () => undefined, manager), /registration failed/);
  assert.throws(() => registerManagerCommands({ inject(_names, callback) { callback({ commands: { register() { throw new Error('command collision'); } } }); } }, {}, () => undefined, manager), /command collision/);
});

test('cc-export empty and list actually read the effective project rather than the immutable header', async (t) => {
  const f = await fixture(t);
  for (const input of ['', 'list']) {
    const result = await f.invoke('cc-export', input);
    assert.equal(result.kind, 'success'); assert.match(result.text, /fixture-skill/);
    assert.ok(result.text.includes(f.effective));
    assert.equal(result.text.includes(f.old), false);
  }
  await assert.rejects(access(join(f.effective, '.claude')));
});

test('cc-export writes a real temporary target and honors a final boolean --overwrite', async (t) => {
  const f = await fixture(t), target = join(f.root, 'exported skills');
  await mkdir(join(target, 'fixture-skill'), { recursive: true });
  const file = join(target, 'fixture-skill', 'SKILL.md');
  await writeFile(file, 'EXISTING_SKILL');
  const first = await f.invoke('cc-export', `export --target "${target}"`);
  assert.equal(first.kind, 'success'); assert.match(first.text, /skipped 1/);
  assert.equal(await readFile(file, 'utf8'), 'EXISTING_SKILL');
  const replaced = await f.invoke('cc-export', `export --target "${target}" --overwrite`);
  assert.equal(replaced.kind, 'success'); assert.match(replaced.text, /exported 1/);
  const content = await readFile(file, 'utf8');
  assert.match(content, /EFFECTIVE_SKILL_BODY/); assert.doesNotMatch(content, /OLD_HEADER_BODY/);
  assert.match(content, /name: "fixture-skill"/);
});

test('cc-export resolves relative output in effective cwd and reports failed writes or bad flags', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.invoke('cc-export', 'export --target relative-output')).kind, 'success');
  assert.match(await readFile(join(f.effective, 'relative-output', 'fixture-skill', 'SKILL.md'), 'utf8'), /EFFECTIVE_SKILL_BODY/);
  const blocked = join(f.root, 'not-a-directory'); await writeFile(blocked, 'BLOCKED');
  const failed = await f.invoke('cc-export', `export --target "${blocked}"`);
  assert.equal(failed.kind, 'error'); assert.match(failed.text, /fail:/);
  assert.equal(await readFile(blocked, 'utf8'), 'BLOCKED');
  for (const input of ['export --target', 'export --target ""', 'export --unknown value']) {
    const outcome = await f.invoke('cc-export', input);
    assert.equal(outcome.kind, 'error'); assert.match(outcome.text, /Unknown option or missing value/);
  }
});

test('cc-export reports an invalid skills directory instead of claiming an empty catalog', async (t) => {
  const f = await fixture(t), broken = join(f.root, 'broken project');
  await mkdir(join(broken, '.git'), { recursive: true });
  await mkdir(join(broken, '.dsh'));
  await writeFile(join(broken, '.dsh', 'skills'), 'NOT_A_DIRECTORY');
  const outcome = await f.invoke('cc-export', `list --cwd "${broken}"`);
  assert.equal(outcome.kind, 'error'); assert.match(outcome.text, /ENOTDIR/);
});

test('pre-cancelled export does not create output files', async (t) => {
  const f = await fixture(t), target = join(f.root, 'cancelled output');
  const controller = new AbortController(); controller.abort();
  const outcome = await f.invoke('cc-export', `export --target "${target}"`, f.agent, controller.signal);
  assert.equal(outcome.kind, 'error'); assert.match(outcome.text, /cancelled/);
  await assert.rejects(access(target));
});

test('Desktop export resolves a Node interpreter through the native subprocess service', async (t) => {
  const resolved = [];
  const f = await fixture(t, { subprocess: { async resolveExecutable(...args) { resolved.push(args); return process.execPath; } } });
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'electron');
  Object.defineProperty(process.versions, 'electron', { value: 'fixture-desktop', configurable: true });
  t.after(() => { if (descriptor) Object.defineProperty(process.versions, 'electron', descriptor); else delete process.versions.electron; });
  const signal = new AbortController().signal;
  const outcome = await f.invoke('cc-export', 'list', f.agent, signal);
  assert.equal(outcome.kind, 'success'); assert.match(outcome.text, /fixture-skill/);
  assert.equal(resolved.length, 1); assert.equal(resolved[0][0], 'node'); assert.equal(resolved[0][2], signal);
  const unavailable = await fixture(t);
  const missing = await unavailable.invoke('cc-export', 'list');
  assert.equal(missing.kind, 'error'); assert.match(missing.text, /Node executable is required/);
});

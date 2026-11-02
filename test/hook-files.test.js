// FileChanged, ConfigChange and the settings file list, on real files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHookSettings, settingsFiles } from '../src/hooks.js';
import { fakeAgent, fakeSubagent, harness, say, tempDir, waitFor, withWarnings } from './hook-kit.js';

const logTo = (file) => `cat | tr -d '\\n' >> "${file}"; echo >> "${file}"`;
const readLines = (file) => {
  try {
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
const created = (h, agent, source = 'startup') => h.dispatch('agent/created', [{ agent, source }], () => {});

// ─── FileChanged ─────────────────────────────────────────────────────────────

test('FileChanged runs when a file that the matcher names changes in the session directory', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ FileChanged: [{ matcher: '.envrc|.env', hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, '.envrc'), 'export A=1');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  const [call] = readLines(log);
  assert.deepEqual([call.hook_event_name, call.file_path, call.event, call.session_id], ['FileChanged', join(cwd, '.envrc'), 'add', 's1']);
  writeFileSync(join(cwd, '.env'), 'B=2');
  assert.ok(await waitFor(() => readLines(log).length === 2), 'each name in the matcher is watched');
  await h.dispose();
});

test('FileChanged reports add, change and unlink', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ FileChanged: [{ matcher: 'data.csv', hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeAgent('s1', cwd));
  const file = join(cwd, 'data.csv');
  writeFileSync(file, 'a');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  writeFileSync(file, 'a,b,c');
  assert.ok(await waitFor(() => readLines(log).length === 2));
  rmSync(file);
  assert.ok(await waitFor(() => readLines(log).length === 3));
  assert.deepEqual(readLines(log).map((call) => call.event), ['add', 'change', 'unlink']);
  await h.dispose();
});

test('FileChanged does not report a file that no matcher names', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ FileChanged: [{ matcher: '.envrc', hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'other.txt'), 'x');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(readLines(log), []);
  await h.dispose();
});

test('FileChanged with no matcher watches no file', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ FileChanged: [{ hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'anything.txt'), 'x');
  writeFileSync(join(cwd, '.*'), 'x'); // the default match-all pattern is not a file name
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(readLines(log), []);
  await h.dispose();
});

test('FileChanged: a file that exists when the session starts is not an add', async () => {
  const cwd = tempDir('dcc-fc-');
  writeFileSync(join(cwd, '.envrc'), 'x');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ FileChanged: [{ matcher: '.envrc', hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeAgent('s1', cwd));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(readLines(log), []);
  await h.dispose();
});

test('FileChanged: a hook with the hook matcher reads the basename of the changed file', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({
    FileChanged: [
      { matcher: 'a.txt|b.txt', hooks: [{ command: logTo(log) }] },
      { matcher: 'b.txt', hooks: [{ command: 'exit 9' }] },
    ],
  });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'a.txt'), 'x');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  assert.equal(readLines(log).length, 1);
  await h.dispose();
});

test('FileChanged: watchPaths from the hook adds files to watch, and replaces the earlier list', async () => {
  const cwd = tempDir('dcc-fc-');
  const other = tempDir('dcc-other-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const extra = join(other, 'x.env');
  const command = `cat >> "${log}"; echo >> "${log}"; printf '%s' '${JSON.stringify({ hookSpecificOutput: { watchPaths: [extra] } })}'`;
  const h = harness({ FileChanged: [{ matcher: 'x.env', hooks: [{ command }] }] });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'x.env'), 'a');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.drain(); // the hook has finished and its watchPaths are applied
  writeFileSync(extra, 'b');
  assert.ok(await waitFor(() => readLines(log).length === 2), 'the returned path is watched');
  assert.equal(readLines(log)[1].file_path, extra);
  await h.dispose();
});

test('FileChanged: a hook that returns an empty watchPaths clears the dynamic list', async () => {
  const cwd = tempDir('dcc-fc-');
  const other = tempDir('dcc-other-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const extra = join(other, 'x.env');
  const flag = join(tempDir('dcc-flag-'), 'flag');
  const returnPaths = (paths) => `printf '%s' '${JSON.stringify({ hookSpecificOutput: { watchPaths: paths } })}'`;
  const command = `cat >> "${log}"; echo >> "${log}"; if [ -e "${flag}" ]; then ${returnPaths([])}; else touch "${flag}"; ${returnPaths([extra])}; fi`;
  const h = harness({ FileChanged: [{ matcher: 'x.env', hooks: [{ command }] }] });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'x.env'), 'a');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.drain();
  writeFileSync(extra, 'b');
  assert.ok(await waitFor(() => readLines(log).length === 2));
  await h.drain();
  writeFileSync(extra, 'bb');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(readLines(log).length, 2, 'the list was cleared by the second run');
  await h.dispose();
});

test('SessionStart watchPaths add files to watch', async () => {
  const cwd = tempDir('dcc-fc-');
  const other = tempDir('dcc-other-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const extra = join(other, 'x.env');
  const h = harness({
    SessionStart: [{ hooks: [{ command: say({ hookSpecificOutput: { watchPaths: [extra] } }) }] }],
    FileChanged: [{ matcher: 'x.env', hooks: [{ command: logTo(log) }] }],
  });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(extra, 'x');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.dispose();
});

test('CwdChanged points the matcher files at the new directory, and its watchPaths replace the dynamic list', async () => {
  const first = tempDir('dcc-fc-');
  const second = tempDir('dcc-fc2-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({
    CwdChanged: [{ hooks: [{ command: 'true' }] }],
    FileChanged: [{ matcher: '.envrc', hooks: [{ command: logTo(log) }] }],
  });
  const agent = fakeAgent('s1', first);
  await created(h, agent);
  const session = agent.session;
  await h.dispatch('session/event', [session, { type: 'working-directory/change', seq: 1, time: 0, data: { cwd: second } }], () => {});
  await h.drain();
  writeFileSync(join(first, '.envrc'), 'old dir');
  writeFileSync(join(second, '.envrc'), 'new dir');
  assert.ok(await waitFor(() => readLines(log).length >= 1));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(readLines(log).map((call) => call.file_path), [join(second, '.envrc')]);
  await h.dispose();
});

test('a disposed agent stops its watch, and a subagent does not start one', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ FileChanged: [{ matcher: 'a.txt', hooks: [{ command: logTo(log) }] }] });
  const child = fakeSubagent('sub-1', 's1');
  child.session.header.cwd = cwd;
  await created(h, child);
  const agent = fakeAgent('s1', cwd);
  await created(h, agent);
  h.dispatch('agent/disposed', [{ agent }], () => {});
  writeFileSync(join(cwd, 'a.txt'), 'x');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(readLines(log), []);
  await h.dispose();
});

// ─── ConfigChange ────────────────────────────────────────────────────────────

test('ConfigChange runs when the user settings file changes, with source and file path', async () => {
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ ConfigChange: [{ matcher: 'user_settings', hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeAgent('s1', '/work'));
  const settings = join(h.dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks: { ConfigChange: [{ matcher: 'user_settings', hooks: [{ command: logTo(log) }] }] }, other: 1 }));
  assert.ok(await waitFor(() => readLines(log).length === 1));
  const [call] = readLines(log);
  assert.deepEqual([call.hook_event_name, call.source, call.file_path, call.session_id], ['ConfigChange', 'user_settings', settings, 's1']);
  await h.dispose();
});

test('ConfigChange: with no block, the plugin reloads its hooks', async () => {
  const log = join(tempDir('dcc-log-'), 'lines');
  const marker = join(tempDir('dcc-marker-'), 'ran');
  const h = harness({
    ConfigChange: [{ hooks: [{ command: logTo(log) }] }],
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }],
  });
  await created(h, fakeAgent('s1', '/work'));
  writeFileSync(join(h.dir, 'settings.json'), JSON.stringify({
    hooks: {
      ConfigChange: [{ hooks: [{ command: logTo(log) }] }],
      PreToolUse: [{ matcher: '.*', hooks: [{ command: `echo reloaded >> "${marker}"; exit 2` }] }],
    },
  }));
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.drain(); // the reload runs after the ConfigChange hook ends
  const agent = fakeAgent('s1', '/work');
  const decision = await h.dispatch('tools/pre-execute', [{ name: 'Read', arguments: {}, callId: 'c', agent }], async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'deny', 'the new PreToolUse hook is in effect');
  assert.equal(readFileSync(marker, 'utf8').trim(), 'reloaded');
  await h.dispose();
});

test('ConfigChange: a hook that blocks keeps the old hooks, and says so', async () => {
  const marker = join(tempDir('dcc-marker-'), 'ran');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({
    ConfigChange: [{ hooks: [{ command: `${logTo(log)}; echo not now >&2; exit 2` }] }],
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }],
  });
  await created(h, fakeAgent('s1', '/work'));
  const { warnings } = await withWarnings(async () => {
    writeFileSync(join(h.dir, 'settings.json'), JSON.stringify({
      hooks: {
        ConfigChange: [{ hooks: [{ command: `${logTo(log)}; exit 2` }] }],
        PreToolUse: [{ matcher: '.*', hooks: [{ command: `echo new >> "${marker}"; exit 2` }] }],
      },
    }));
    await waitFor(() => readLines(log).length === 1);
    await h.drain();
  });
  assert.match(warnings.join('\n'), /ConfigChange hook blocked the user_settings change/);
  const decision = await h.dispatch('tools/pre-execute', [{ name: 'Read', arguments: {}, callId: 'c', agent: fakeAgent() }], async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'allow', 'the old PreToolUse hook is still in effect');
  await h.dispose();
});

test('ConfigChange: a reload that adds an event with no listener warns about a restart', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }] });
  const { warnings } = await withWarnings(async () => {
    writeFileSync(join(h.dir, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }],
        Stop: [{ hooks: [{ command: 'exit 0' }] }],
      },
    }));
    await waitFor(() => h.engine.events().has('stop'));
    await h.drain();
  });
  assert.match(warnings.join('\n'), /need a restart: stop/);
  await h.dispose();
});

test('ConfigChange: skills/change runs the hook with source skills, but not before the first agent', async () => {
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ ConfigChange: [{ matcher: 'skills', hooks: [{ command: logTo(log) }] }] });
  h.dispatch('skills/change', [], () => {});
  await h.drain();
  assert.deepEqual(readLines(log), [], 'DSH reports skills while it starts');
  await created(h, fakeAgent('s1', '/work'));
  h.dispatch('skills/change', [], () => {});
  await h.drain();
  const [call] = readLines(log);
  assert.equal(call.source, 'skills');
  assert.equal('file_path' in call, false);
  await h.dispose();
});

// ─── settings files ──────────────────────────────────────────────────────────

test('settingsFiles lists user, project and project-local settings, and hooks load from all three', () => {
  const user = tempDir('dcc-user-');
  const project = tempDir('dcc-proj-');
  mkdirSync(join(project, '.git'));
  mkdirSync(join(project, '.claude'));
  const hook = (command) => ({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command }] }] });
  writeFileSync(join(user, 'settings.json'), JSON.stringify({ hooks: hook('echo user') }));
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ hooks: hook('echo project') }));
  writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ hooks: hook('echo local') }));
  const before = process.cwd();
  process.chdir(project);
  try {
    const config = { userClaudeDir: user, projectRootMarkers: ['.git'] };
    assert.deepEqual(settingsFiles(config).map((file) => file.source), ['user_settings', 'project_settings', 'local_settings']);
    const commands = Object.values(loadHookSettings(config)).map((entry) => entry.command).sort();
    assert.deepEqual(commands, ['echo local', 'echo project', 'echo user']);
  } finally {
    process.chdir(before);
  }
});

test('settingsFiles outside a project lists only the user settings', () => {
  const outside = tempDir('dcc-outside-');
  const before = process.cwd();
  process.chdir(outside);
  try {
    const files = settingsFiles({ userClaudeDir: tempDir('dcc-user-'), projectRootMarkers: ['.git-not-here'] });
    assert.deepEqual(files.map((file) => file.source), ['user_settings']);
  } finally {
    process.chdir(before);
  }
});

// ─── cases that pin down the details ─────────────────────────────────────────

test('FileChanged: a plain name in the matcher must equal the file name, not just appear in its path', async () => {
  const cwd = tempDir('dcc-fc-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({
    FileChanged: [
      { matcher: 'Makefile|Justfile', hooks: [{ command: logTo(log) }] },
      { matcher: 'Make', hooks: [{ command: 'exit 9' }] },
    ],
  });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'Makefile'), 'all:');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.dispose();
});

test('FileChanged: a run that returns no watchPaths keeps the dynamic list', async () => {
  const cwd = tempDir('dcc-fc-');
  const other = tempDir('dcc-other-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const extra = join(other, 'x.env');
  const flag = join(tempDir('dcc-flag-'), 'flag');
  const paths = `printf '%s' '${JSON.stringify({ hookSpecificOutput: { watchPaths: [extra] } })}'`;
  const command = `cat >> "${log}"; echo >> "${log}"; if [ -e "${flag}" ]; then :; else touch "${flag}"; ${paths}; fi`;
  const h = harness({ FileChanged: [{ matcher: 'x.env', hooks: [{ command }] }] });
  await created(h, fakeAgent('s1', cwd));
  writeFileSync(join(cwd, 'x.env'), 'a');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.drain();
  writeFileSync(extra, 'b');
  assert.ok(await waitFor(() => readLines(log).length === 2));
  await h.drain();
  writeFileSync(extra, 'bbb');
  assert.ok(await waitFor(() => readLines(log).length === 3), 'a run with no watchPaths did not clear the list');
  await h.dispose();
});

test('CwdChanged: a hook that returns no watchPaths keeps the dynamic list', async () => {
  const cwd = tempDir('dcc-fc-');
  const next = tempDir('dcc-fc2-');
  const other = tempDir('dcc-other-');
  const log = join(tempDir('dcc-log-'), 'lines');
  const extra = join(other, 'x.env');
  const h = harness({
    SessionStart: [{ hooks: [{ command: say({ hookSpecificOutput: { watchPaths: [extra] } }) }] }],
    CwdChanged: [{ hooks: [{ command: 'true' }] }],
    FileChanged: [{ matcher: 'x.env', hooks: [{ command: logTo(log) }] }],
  });
  const agent = fakeAgent('s1', cwd);
  await created(h, agent);
  await h.dispatch('session/event', [agent.session, { type: 'working-directory/change', seq: 1, time: 0, data: { cwd: next } }], () => {});
  await h.drain();
  writeFileSync(extra, 'x');
  assert.ok(await waitFor(() => readLines(log).length === 1));
  await h.dispose();
});

test('ConfigChange: a skills change does not reload the hook list', async () => {
  const { registerConfigHooks } = await import('../src/hook-bridge-config.js');
  const listeners = new Map();
  const ctx = { on: (name, fn) => listeners.set(name, fn), effect: () => {} };
  const engine = { events: () => new Set(['stop']), fire: async () => ({ blocked: false, stopped: false }) };
  const tracked = [];
  const support = { track: (promise) => tracked.push(promise), payload: () => ({}) };
  let reloads = 0;
  registerConfigHooks(ctx, engine, support, { files: [], reload: () => { reloads += 1; }, intervalMs: 1_000_000 });
  listeners.get('agent/created')({ agent: fakeAgent() });
  listeners.get('skills/change')();
  await Promise.all(tracked);
  assert.equal(reloads, 0);
});

test('ConfigChange: a subagent does not count as the first agent', async () => {
  const log = join(tempDir('dcc-log-'), 'lines');
  const h = harness({ ConfigChange: [{ matcher: 'skills', hooks: [{ command: logTo(log) }] }] });
  await created(h, fakeSubagent('sub-1', 's1'));
  h.dispatch('skills/change', [], () => {});
  await h.drain();
  assert.deepEqual(readLines(log), []);
  await h.dispose();
});

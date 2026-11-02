// Hook handler parsing and the `if` rule (src/hook-spec.js). Pure functions, no I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchIfRule, parseHookHandler } from '../src/hook-spec.js';

const PROJECT = '/work/project';

function parse(raw, event = 'pre-tool-use') {
  return parseHookHandler(raw, { event, projectDir: PROJECT });
}

// ─── command handlers ────────────────────────────────────────────────────────

test('a plain command handler keeps its defaults', () => {
  const result = parse({ type: 'command', command: 'echo hi' });
  assert.equal(result.ok, true);
  assert.equal(result.handler.type, 'command');
  assert.equal(result.handler.command, 'echo hi');
  assert.equal(result.handler.args, undefined);
  assert.equal(result.handler.timeoutMs, undefined);
  assert.equal(result.handler.async, false);
  assert.equal(result.handler.onFailure, 'continue');
  assert.equal(result.handler.projectDir, PROJECT);
  assert.deepEqual(result.notes, []);
});

test('a handler with no type is a command handler', () => {
  assert.equal(parse({ command: 'x' }).handler.type, 'command');
});

test('timeout is seconds in settings and milliseconds at run time', () => {
  assert.equal(parse({ command: 'x', timeout: 2 }).handler.timeoutMs, 2000);
  assert.equal(parse({ command: 'x', timeout: 0.5 }).handler.timeoutMs, 500);
  assert.equal(parse({ command: 'x', timeout: 0.001 }).handler.timeoutMs, 1);
  assert.equal(parse({ command: 'x', timeout: 2147483.647 }).handler.timeoutMs, 2147483647);
});

test('exec form expands CLAUDE_PROJECT_DIR as data, even with $& in the path', () => {
  const result = parseHookHandler(
    { command: '${CLAUDE_PROJECT_DIR}/bin/check', args: ['--root', '${CLAUDE_PROJECT_DIR}', '$HOME'] },
    { event: 'pre-tool-use', projectDir: '/w/a$&b' },
  );
  assert.equal(result.handler.command, '/w/a$&b/bin/check');
  assert.deepEqual(result.handler.args, ['--root', '/w/a$&b', '$HOME']);
});

test('shell form keeps the variable token: the shell reads it from the environment', () => {
  assert.equal(parse({ command: 'check "${CLAUDE_PROJECT_DIR}"' }).handler.command, 'check "${CLAUDE_PROJECT_DIR}"');
});

test('shell must be bash; powershell is rejected because hooks run in /bin/sh', () => {
  assert.equal(parse({ command: 'x', shell: 'bash' }).ok, true);
  assert.match(parse({ command: 'x', shell: 'powershell' }).reason, /shell "powershell" is not supported/);
});

// ─── the other handler types ─────────────────────────────────────────────────

test('an http handler needs an http(s) url; headers and allowedEnvVars are checked', () => {
  const ok = parse({ type: 'http', url: 'https://example.test/hook', headers: { A: 'b' }, allowedEnvVars: ['TOKEN'] });
  assert.equal(ok.ok, true);
  assert.equal(ok.handler.url, 'https://example.test/hook');
  assert.deepEqual(ok.handler.allowedEnvVars, ['TOKEN']);
  assert.match(parse({ type: 'http' }).reason, /url is missing/);
  assert.match(parse({ type: 'http', url: 'ftp://x' }).reason, /http:\/\/ or https:\/\//);
  assert.match(parse({ type: 'http', url: 'http://x', headers: { A: 1 } }).reason, /headers must be/);
  assert.match(parse({ type: 'http', url: 'http://x', allowedEnvVars: 'T' }).reason, /allowedEnvVars must be/);
});

test('an mcp_tool handler needs a server and a tool; input must be an object', () => {
  const ok = parse({ type: 'mcp_tool', server: 'scan', tool: 'check', input: { path: '${tool_input.file_path}' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.handler.server, 'scan');
  assert.deepEqual(ok.handler.input, { path: '${tool_input.file_path}' });
  assert.match(parse({ type: 'mcp_tool', tool: 'x' }).reason, /server is missing/);
  assert.match(parse({ type: 'mcp_tool', server: 's' }).reason, /tool is missing/);
  assert.match(parse({ type: 'mcp_tool', server: 's', tool: 't', input: [] }).reason, /input must be an object/);
});

test('prompt and agent handlers need a prompt; model is optional', () => {
  for (const type of ['prompt', 'agent']) {
    const ok = parse({ type, prompt: 'Is $ARGUMENTS safe?', model: 'fast' });
    assert.equal(ok.ok, true, type);
    assert.equal(ok.handler.prompt, 'Is $ARGUMENTS safe?');
    assert.equal(ok.handler.model, 'fast');
    assert.match(parse({ type }).reason, /prompt is missing/);
    assert.match(parse({ type, prompt: 'x', model: '' }).reason, /model must be/);
  }
});

test('an unknown handler type is reported with its type name', () => {
  const result = parse({ type: 'websocket', url: 'ws://x' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /handler type "websocket" is not supported/);
});

// ─── common fields ───────────────────────────────────────────────────────────

test('async and asyncRewake run a hook in the background on any event', () => {
  assert.equal(parse({ command: 'x', async: true }, 'pre-tool-use').handler.async, true);
  assert.equal(parse({ command: 'x', async: true }, 'notification').handler.async, true);
  const rewake = parse({ command: 'x', asyncRewake: true }).handler;
  assert.equal(rewake.async, true);
  assert.equal(rewake.asyncRewake, true);
});

test('malformed fields are rejected with a reason, not run with a guess', () => {
  const cases = [
    [null, /not an object/],
    [{}, /command is missing/],
    [{ command: '' }, /command is missing/],
    [{ command: 'x', args: 'not-a-list' }, /args must be/],
    [{ command: 'x', args: [1] }, /args must be/],
    [{ command: 'x', timeout: 0 }, /timeout must be/],
    [{ command: 'x', timeout: 0.0004 }, /timeout must be/],
    [{ command: 'x', timeout: 2147483.648 }, /timeout must be/],
    [{ command: 'x', timeout: NaN }, /timeout must be/],
    [{ command: 'x', timeout: '5' }, /timeout must be/],
    [{ command: 'x', onFailure: 'maybe' }, /onFailure must be/],
    [{ command: 'x', async: 'true' }, /async must be/],
    [{ command: 'x', asyncRewake: 1 }, /asyncRewake must be/],
    [{ command: 'x', once: 'yes' }, /once must be/],
    [{ command: 'x', if: 42 }, /if must be a string/],
    [{ command: 'x', if: 'Bash(git *' }, /not a tool name or Tool\(pattern\)/],
    [{ command: 'x', if: 'WebFetch(domain:x)' }, /patterns are not supported for WebFetch/],
  ];
  for (const [raw, pattern] of cases) {
    const result = parse(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    assert.match(result.reason, pattern);
  }
});

test('if applies on the five tool and permission events, and is rejected elsewhere', () => {
  for (const event of ['pre-tool-use', 'post-tool-use', 'post-tool-use-failure', 'permission-request', 'permission-denied']) {
    assert.equal(parse({ command: 'x', if: 'Bash(git *)' }, event).ok, true, event);
  }
  for (const event of ['session-start', 'stop', 'notification']) {
    const result = parse({ command: 'x', if: 'Bash(git *)' }, event);
    assert.equal(result.ok, false, event);
    assert.match(result.reason, /only to tool events/);
  }
});

test('fields that are accepted but have no effect produce notes', () => {
  assert.match(parse({ command: 'x', onFailure: 'block' }, 'stop').notes[0], /no effect on stop/);
  assert.match(parse({ command: 'x', onFailure: 'block', async: true }).notes[0], /ignored for async/);
  assert.match(parse({ command: 'x', once: true }).notes[0], /skill frontmatter/);
});

test('parsing never throws on odd input, and a rejection always has a reason', () => {
  const odd = [
    undefined, null, 1, 'x', [], {}, { type: 'command' }, { type: 'http' }, { type: 'prompt' },
    { command: 'x', args: [null] }, { command: 'x', if: ['Bash'] },
    { command: 'x', timeout: {} }, { command: 'x', onFailure: null }, { command: 'x', async: null },
  ];
  for (const raw of odd) {
    for (const event of ['pre-tool-use', 'session-start', 'user-prompt-submit']) {
      const result = parse(raw, event);
      if (result.ok) assert.equal(typeof result.handler.async, 'boolean');
      else assert.ok(typeof result.reason === 'string' && result.reason !== '');
    }
  }
});

// ─── matchIfRule ─────────────────────────────────────────────────────────────

test('Bash(pattern) matches the command with a * glob, anchored at both ends', () => {
  const input = { command: 'git status' };
  assert.equal(matchIfRule('Bash(git *)', 'Bash', input), true);
  assert.equal(matchIfRule('Bash(git *)', 'Bash', { command: 'npm test' }), false);
  assert.equal(matchIfRule('Bash(git)', 'Bash', input), false);
  assert.equal(matchIfRule('Bash(git *)', 'Edit', input), false);
});

test('a compound command matches when one subcommand matches', () => {
  assert.equal(matchIfRule('Bash(git push *)', 'Bash', { command: 'cd /tmp && git push --force' }), true);
  assert.equal(matchIfRule('Bash(git push *)', 'Bash', { command: 'ls; git push' }), true);
  assert.equal(matchIfRule('Bash(git push *)', 'Bash', { command: 'echo git push' }), false);
});

test('a trailing " *" also matches the bare command when the rest has no *', () => {
  assert.equal(matchIfRule('Bash(npm run *)', 'Bash', { command: 'npm run' }), true);
  assert.equal(matchIfRule('Bash(npm run *)', 'Bash', { command: 'npm install' }), false);
  assert.equal(matchIfRule('Bash(ls *)', 'Bash', { command: 'ls' }), true);
  assert.equal(matchIfRule('Bash(ls *)', 'Bash', { command: 'lsof' }), false);
});

test('the :* suffix means the same as a trailing " *"', () => {
  assert.equal(matchIfRule('Bash(ls:*)', 'Bash', { command: 'ls -la' }), true);
  assert.equal(matchIfRule('Bash(ls:*)', 'Bash', { command: 'lsof' }), false);
});

test('a * in the middle of a pattern needs the text around it', () => {
  assert.equal(matchIfRule('Bash(* --help *)', 'Bash', { command: 'npm --help x' }), true);
  assert.equal(matchIfRule('Bash(* --help *)', 'Bash', { command: 'npm --help' }), false);
  assert.equal(matchIfRule('Bash(git log * main)', 'Bash', { command: 'git log --oneline main' }), true);
  assert.equal(matchIfRule('Bash(git log * main)', 'Bash', { command: 'git log main' }), false);
});

test('a bare tool name matches every call to that tool', () => {
  assert.equal(matchIfRule('Bash', 'Bash', { command: 'anything' }), true);
  assert.equal(matchIfRule('Bash', 'Read', { file_path: '/x' }), false);
});

test('Edit(glob) and Write(glob) match the file path', () => {
  assert.equal(matchIfRule('Edit(*.ts)', 'Edit', { file_path: 'src/a.ts' }), true);
  assert.equal(matchIfRule('Edit(*.ts)', 'Edit', { file_path: 'src/a.js' }), false);
  assert.equal(matchIfRule('Write(*.md)', 'Write', { file_path: 'README.md' }), true);
});

test('NotebookEdit matches notebook_path, the field its input uses', () => {
  assert.equal(matchIfRule('NotebookEdit(*.ipynb)', 'NotebookEdit', { notebook_path: 'a.ipynb' }), true);
  assert.equal(matchIfRule('NotebookEdit(*.ipynb)', 'NotebookEdit', { file_path: 'a.ipynb' }), false);
});

test('a pattern never matches when the input has no field for it', () => {
  assert.equal(matchIfRule('Bash(git *)', 'Bash', {}), false);
  assert.equal(matchIfRule('Bash(git *)', 'Bash', null), false);
});

test('a malformed rule never matches', () => {
  assert.equal(matchIfRule('not a rule!', 'Bash', { command: 'x' }), false);
  assert.equal(matchIfRule('', 'Bash', { command: 'x' }), false);
});

test('a literal pattern matches exactly its own text, special characters included', () => {
  const literals = ['a.b', '(a)[b]{c}', '$^+?|-', 'a b/c', 'x\\y', 'npm test'];
  for (const text of literals) {
    assert.equal(matchIfRule(`Bash(${text})`, 'Bash', { command: text }), true, text);
    assert.equal(matchIfRule(`Bash(${text})`, 'Bash', { command: `${text}!` }), false, text);
  }
});

// ─── handler types per event ─────────────────────────────────────────────────

const SAMPLE = {
  command: { type: 'command', command: 'x' },
  http: { type: 'http', url: 'https://example.test/h' },
  mcp_tool: { type: 'mcp_tool', server: 's', tool: 't' },
  prompt: { type: 'prompt', prompt: 'check $ARGUMENTS' },
  agent: { type: 'agent', prompt: 'verify $ARGUMENTS' },
};
const accepts = (event) => Object.keys(SAMPLE).filter((type) => parse(SAMPLE[type], event).ok);

test('prompt and agent hooks run on the twelve events that take them', () => {
  for (const event of ['permission-denied', 'post-tool-batch', 'post-tool-use', 'post-tool-use-failure', 'pre-tool-use',
    'stop', 'subagent-stop', 'task-completed', 'task-created', 'teammate-idle', 'user-prompt-expansion', 'user-prompt-submit']) {
    assert.deepEqual(accepts(event), ['command', 'http', 'mcp_tool', 'prompt', 'agent'], event);
  }
});

test('PermissionRequest takes prompt but not agent hooks', () => {
  assert.deepEqual(accepts('permission-request'), ['command', 'http', 'mcp_tool', 'prompt']);
});

test('SessionStart takes only command and mcp_tool hooks', () => {
  assert.deepEqual(accepts('session-start'), ['command', 'mcp_tool']);
});

test('the other events take command, http and mcp_tool hooks only', () => {
  for (const event of ['notification', 'cwd-changed', 'file-changed', 'session-end', 'stop-failure', 'subagent-start',
    'pre-compact', 'post-compact', 'post-model-switch', 'config-change', 'instructions-loaded', 'message-display']) {
    assert.deepEqual(accepts(event), ['command', 'http', 'mcp_tool'], event);
  }
});

test('a type that the event does not take is skipped with a reason that names both', () => {
  const result = parse(SAMPLE.agent, 'notification');
  assert.equal(result.ok, false);
  assert.match(result.reason, /handler type "agent" is not supported on notification/);
});

test('continueOnBlock is kept for a prompt hook, and ignored with a note elsewhere', () => {
  assert.equal(parse({ ...SAMPLE.prompt, continueOnBlock: true }, 'stop').handler.continueOnBlock, true);
  assert.equal(parse(SAMPLE.prompt, 'stop').handler.continueOnBlock, false);
  const agent = parse({ ...SAMPLE.agent, continueOnBlock: true }, 'stop');
  assert.equal(agent.handler.continueOnBlock, false);
  assert.match(agent.notes[0], /continueOnBlock applies to prompt hooks only/);
  assert.equal(parse({ ...SAMPLE.prompt, continueOnBlock: 'yes' }, 'stop').ok, false);
});

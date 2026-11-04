// Property tests for the parsers: random input from a fixed seed, so a failure repeats.
// The project adds no test dependency for this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMatcher } from '../src/hook-engine.js';
import { interpretRun } from '../src/hook-output.js';
import { mcpToolName, substitute } from '../src/hook-runners-model.js';
import { stopCap } from '../src/hook-bridge-agent.js';
import { matchIfRule, parseHookHandler } from '../src/hook-spec.js';
import { parseVerdict } from '../src/hook-verdict.js';

const RUNS = 400;

// mulberry32: a small seeded generator.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function textFrom(random, alphabet, max = 24) {
  const length = Math.floor(random() * (max + 1));
  let text = '';
  for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(random() * alphabet.length)];
  return text;
}

const WILD = 'abcXYZ019_- ,|*.^$()[]{}\\?+/:;&\n"\'`${}é\u0000';
const SAFE = 'abcXYZ019_-';

test('compileMatcher never throws and always returns a predicate that answers true or false', () => {
  const random = rng(1);
  for (let i = 0; i < RUNS; i += 1) {
    const matcher = textFrom(random, WILD);
    for (const narrow of [false, true]) {
      const predicate = compileMatcher(matcher, { narrow });
      assert.equal(typeof predicate(textFrom(random, WILD)), 'boolean', JSON.stringify(matcher));
    }
  }
});

test('compileMatcher on a list of safe names matches exactly the names in the list', () => {
  const random = rng(2);
  for (let i = 0; i < RUNS; i += 1) {
    const names = Array.from({ length: 1 + Math.floor(random() * 4) }, () => textFrom(random, SAFE, 8) || 'n');
    const separator = random() < 0.5 ? '|' : ',';
    const predicate = compileMatcher(names.join(separator));
    for (const name of names) assert.equal(predicate(name), true, `${names} ${name}`);
    const outsider = `${textFrom(random, SAFE, 8)}#`;
    assert.equal(predicate(outsider), false, `${names} ${outsider}`);
  }
});

test('parseVerdict never throws, and a valid verdict survives prose around it', () => {
  const random = rng(3);
  for (let i = 0; i < RUNS; i += 1) {
    assert.equal(typeof parseVerdict(textFrom(random, WILD, 60)).ok, 'boolean');
  }
  for (let i = 0; i < RUNS; i += 1) {
    const ok = random() < 0.5;
    const reason = textFrom(random, 'abc xyz.', 20).trim() || 'because';
    const verdict = ok ? { ok } : { ok, reason };
    const prose = (limit) => textFrom(random, 'abc xyz.,:\n', limit);
    const result = parseVerdict(`${prose(20)}${JSON.stringify(verdict)}${prose(20)}`);
    assert.equal(result.ok, true);
    assert.equal(result.verdict.ok, ok);
    if (!ok) assert.equal(result.verdict.reason, reason);
  }
});

test('interpretRun never throws, and a failed run never blocks or decides', () => {
  const random = rng(4);
  const events = ['pre-tool-use', 'stop', 'session-start', 'permission-request', 'user-prompt-submit', 'post-tool-use'];
  for (let i = 0; i < RUNS; i += 1) {
    const event = events[Math.floor(random() * events.length)];
    const run = {
      exitCode: Math.floor(random() * 4),
      stdout: random() < 0.5 ? textFrom(random, WILD, 60) : JSON.stringify({ decision: textFrom(random, 'blockab', 6), reason: 'r' }),
      stderr: textFrom(random, WILD, 20),
      failed: random() < 0.3,
      reason: 'why',
    };
    const outcome = interpretRun(event, 'X', run);
    if (run.failed) assert.deepEqual([outcome.blocked, outcome.permission, outcome.contexts], [false, undefined, []]);
  }
});

test('interpretRun: exit 2 blocks every event that can block, whatever the output', () => {
  const random = rng(5);
  for (let i = 0; i < RUNS; i += 1) {
    const run = { exitCode: 2, stdout: textFrom(random, WILD, 40), stderr: textFrom(random, WILD, 40), failed: false };
    for (const event of ['pre-tool-use', 'stop', 'user-prompt-submit', 'post-tool-batch']) {
      assert.equal(interpretRun(event, 'X', run).blocked, true, event);
    }
  }
});

test('matchIfRule never throws on odd rules, and a plain pattern matches the command it names', () => {
  const random = rng(6);
  for (let i = 0; i < RUNS; i += 1) {
    const rule = `Bash(${textFrom(random, WILD, 20)})`;
    assert.equal(typeof matchIfRule(rule, 'Bash', { command: textFrom(random, WILD, 20) }), 'boolean', rule);
  }
  for (let i = 0; i < RUNS; i += 1) {
    const command = `git ${textFrom(random, 'abcXYZ019-./', 12)}`;
    assert.equal(matchIfRule(`Bash(${command})`, 'Bash', { command }), true, command);
  }
});

test('substitute leaves a value with no placeholder unchanged', () => {
  const random = rng(7);
  const value = (depth) => {
    const pick = random();
    if (depth > 2 || pick < 0.4) return textFrom(random, 'abc $xyz{}', 12).replaceAll('${', '$ {');
    if (pick < 0.6) return Math.floor(random() * 100);
    if (pick < 0.8) return Array.from({ length: 3 }, () => value(depth + 1));
    return { a: value(depth + 1), b: value(depth + 1) };
  };
  for (let i = 0; i < RUNS; i += 1) {
    const input = value(0);
    assert.deepEqual(substitute(input, { cwd: '/w' }), input);
  }
});

test('mcpToolName gives a valid DSH tool name, the same one each time, and one per tool', () => {
  const random = rng(8);
  for (let i = 0; i < RUNS; i += 1) {
    const server = textFrom(random, WILD, 40) || 's';
    const tool = textFrom(random, WILD, 80) || 't';
    const name = mcpToolName(server, tool);
    assert.match(name, /^[A-Za-z0-9_-]{1,64}$/, name);
    assert.equal(mcpToolName(server, tool), name);
    const other = `${tool}x`;
    assert.notEqual(mcpToolName(server, other), name, `${tool} and ${other}`);
  }
});

// ─── stopCap, parseHookHandler ───────────────────────────────────────────────

test('property: stopCap is a positive safe integer, and equals the value only for a plain digit run', () => {
  const random = rng(1101);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < RUNS; i += 1) {
      const given = textFrom(random, '0123456789xe+-. ', 12);
      const cap = stopCap({ CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: given });
      assert.ok(Number.isSafeInteger(cap) && cap > 0, JSON.stringify(given));
      const plain = /^[1-9][0-9]{0,8}$/.test(given);
      assert.equal(cap, plain ? Number(given) : 8, JSON.stringify(given));
    }
  } finally {
    console.warn = originalWarn;
  }
});

test('property: parseHookHandler never throws; ok gives a bounded timeout, and a rejection gives a reason', () => {
  const random = rng(1102);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const values = () => pick([undefined, null, 0, -1, 1, 2.5, 1e12, 'x', '', 'a b', 'openai/', 'p/m', true, [], {}, ['a'], [1]]);
  const types = ['command', 'http', 'mcp_tool', 'prompt', 'agent', 'bogus', undefined, 7];
  const events = ['pre-tool-use', 'post-tool-use', 'session-start', 'stop', 'user-prompt-submit'];
  const fields = ['command', 'args', 'timeout', 'async', 'onFailure', 'if', 'url', 'headers', 'server', 'tool', 'prompt', 'model'];
  for (let i = 0; i < RUNS; i += 1) {
    const raw = { type: pick(types) };
    for (const field of fields) if (random() < 0.5) raw[field] = values();
    const result = parseHookHandler(raw, { event: pick(events), projectDir: '/proj' });
    if (result.ok) {
      const { timeoutMs, command, args } = result.handler;
      assert.ok(timeoutMs === undefined || (Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 2147483647), JSON.stringify(raw));
      assert.ok(!String(command ?? '').includes('${CLAUDE_PROJECT_DIR}') || args === undefined, JSON.stringify(raw));
      assert.ok(Array.isArray(result.notes));
    } else {
      assert.ok(typeof result.reason === 'string' && result.reason !== '', JSON.stringify(raw));
    }
  }
});

test('property: an accepted prompt model has no empty or extra segment', () => {
  const random = rng(1103);
  for (let i = 0; i < RUNS; i += 1) {
    const model = textFrom(random, 'ab/ -', 10);
    const result = parseHookHandler({ type: 'prompt', prompt: 'ok?', model }, { event: 'pre-tool-use', projectDir: '/p' });
    if (!result.ok) continue;
    const parts = model.trim().split('/');
    assert.ok(parts.length <= 2 && parts.every((part) => part !== '' && !/\s/.test(part)), JSON.stringify(model));
  }
});

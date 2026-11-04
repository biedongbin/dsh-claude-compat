// Property tests for the parsers: random input from a fixed seed, so a failure repeats.
// The project adds no test dependency for this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMatcher } from '../src/hook-engine.js';
import { interpretRun, mergeOutcomes } from '../src/hook-output.js';
import { buildPrompt, mcpToolName, substitute } from '../src/hook-runners-model.js';
import { stopCap } from '../src/hook-bridge-agent.js';
import { matcherPaths } from '../src/hook-bridge-files.js';
import { splitLines } from '../src/hook-bridge-messages.js';
import { completedTodos, createdTodos } from '../src/hook-bridge-tasks.js';
import { matchIfRule, parseHookHandler } from '../src/hook-spec.js';
import { denyRun, parseVerdict, verdictToRun } from '../src/hook-verdict.js';
import { appendCapped, runHttpHook } from '../src/hook-handlers.js';
import { failureText } from '../src/hook-bridge-tools.js';
import { blocksToText } from '../src/hook-support.js';

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

// ─── matcherPaths, splitLines, todos, mergeOutcomes, substitute, buildPrompt ─────────────────────

test('property: matcherPaths returns one absolute path for each non-empty, non-match-all name', () => {
  const random = rng(1201);
  const noWarn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < RUNS; i += 1) {
      const parts = Array.from({ length: Math.floor(random() * 5) }, () => textFrom(random, 'ab./ _-*', 8));
      const matcher = parts.join(random() < 0.5 ? '|' : ' | ');
      const paths = matcherPaths({ matchers: () => [matcher] }, '/session/dir');
      const expected = matcher.split('|').map((name) => name.trim()).filter((name) => !['', '*', '.*'].includes(name));
      assert.equal(paths.length, expected.length, JSON.stringify(matcher));
      assert.ok(paths.every((path) => path.startsWith('/')), JSON.stringify(matcher));
    }
  } finally {
    console.warn = noWarn;
  }
});

test('property: splitLines gives back the text, with whole lines first and no newline in the rest', () => {
  const random = rng(1202);
  for (let i = 0; i < RUNS; i += 1) {
    const text = textFrom(random, 'ab \n\n', 30);
    const [lines, rest] = splitLines(text);
    assert.equal(lines + rest, text, JSON.stringify(text));
    assert.ok(lines === '' || lines.endsWith('\n'), JSON.stringify(text));
    assert.ok(!rest.includes('\n'), JSON.stringify(text));
  }
});

test('property: created and completed todos match the old list one to one by text', () => {
  const random = rng(1203);
  const statuses = ['pending', 'in_progress', 'completed'];
  const list = () => Array.from({ length: Math.floor(random() * 6) }, () => ({
    content: ['a', 'b', 'c'][Math.floor(random() * 3)],
    status: statuses[Math.floor(random() * 3)],
  }));
  const tally = (todos) => todos.reduce((counts, todo) => counts.set(todo.content, (counts.get(todo.content) ?? 0) + 1), new Map());
  for (let i = 0; i < RUNS; i += 1) {
    const previous = list();
    const next = list();
    const created = createdTodos(previous, next);
    assert.ok(created.every(({ todo, index }) => next[index] === todo), 'each index points at its todo in next');
    const seen = tally(previous);
    const newTexts = tally(next);
    for (const [text, count] of seen) newTexts.set(text, Math.max(0, (newTexts.get(text) ?? 0) - count));
    assert.deepEqual(tally(created.map(({ todo }) => todo)), new Map([...newTexts].filter(([, count]) => count > 0)));
    const done = completedTodos(previous, next);
    assert.ok(done.every(({ todo }) => todo.status === 'completed'));
    assert.ok(done.length <= next.filter((todo) => todo.status === 'completed').length);
  }
});

test('property: mergeOutcomes keeps the strongest permission in any order, ORs blocks, and skips failed runs', () => {
  const random = rng(1204);
  const decide = (permission) => interpretRun('pre-tool-use', 'PreToolUse', {
    exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: permission } }), failed: false,
  });
  const rank = { deny: 4, defer: 3, ask: 2, allow: 1 };
  const pool = () => [
    ...Array.from({ length: 1 + Math.floor(random() * 4) }, () => decide(['allow', 'ask', 'defer', 'deny'][Math.floor(random() * 4)])),
    ...Array.from({ length: Math.floor(random() * 2) }, () => interpretRun('pre-tool-use', 'PreToolUse', { exitCode: 2, stdout: '', stderr: 'no', failed: false })),
  ];
  const shuffle = (list) => list.map((item) => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
  for (let i = 0; i < RUNS; i += 1) {
    const outcomes = pool();
    const merged = mergeOutcomes(outcomes);
    const expected = outcomes.filter((outcome) => outcome.permission !== undefined)
      .reduce((best, outcome) => ((rank[outcome.permission] > (rank[best] ?? 0)) ? outcome.permission : best), undefined);
    assert.equal(merged.permission, expected);
    assert.equal(mergeOutcomes(shuffle(outcomes)).permission, merged.permission, 'order does not change the permission');
    assert.equal(merged.blocked, outcomes.some((outcome) => outcome.blocked));
    const failed = interpretRun('pre-tool-use', 'PreToolUse', { exitCode: 1, stdout: '', failed: true, reason: 'exit 1' });
    assert.deepEqual(mergeOutcomes([...outcomes, failed]).permission, merged.permission);
    assert.equal(mergeOutcomes([...outcomes, failed]).blocked, merged.blocked);
  }
});

test('property: substitute puts a field of the input at its placeholder, as data, and leaves no placeholder', () => {
  const random = rng(1205);
  for (let i = 0; i < RUNS; i += 1) {
    const value = textFrom(random, 'ab$&{}1 \\', 10);
    const input = { tool_input: { file_path: value, n: Math.floor(random() * 100) } };
    const template = `x ${'${tool_input.file_path}'} y ${'${tool_input.n}'} z ${'${tool_input.missing}'}`;
    assert.equal(substitute(template, input), `x ${value} y ${input.tool_input.n} z `, JSON.stringify(value));
    assert.deepEqual(substitute({ a: [template] }, input), { a: [`x ${value} y ${input.tool_input.n} z `] });
  }
});

test('property: buildPrompt always carries the payload verbatim, and appends it when there is no $ARGUMENTS', () => {
  const random = rng(1206);
  for (let i = 0; i < RUNS; i += 1) {
    const prompt = textFrom(random, 'ab $&1\n', 12).replaceAll('$ARGUMENTS', '');
    const payload = textFrom(random, 'ab$&1`{}\n ', 14);
    assert.ok(buildPrompt(prompt, payload).includes(payload), JSON.stringify({ prompt, payload }));
    if (!prompt.includes('$ARGUMENTS')) assert.equal(buildPrompt(prompt, payload), `${prompt}\n\n${payload}`);
    const withToken = buildPrompt(`before $ARGUMENTS after`, payload);
    assert.equal(withToken, `before ${payload} after`, JSON.stringify(payload));
  }
});

// ─── appendCapped, http headers and responses, readBody, denyRun, verdictToRun ───────────────────

const LIMIT = 1_048_576;
const ASTRAL = '\u{1F600}';

test('property: appendCapped is a prefix of the join, is well formed, and stays within the limit', () => {
  const random = rng(1301);
  for (let i = 0; i < 40; i += 1) {
    const head = 'a'.repeat(LIMIT - Math.floor(random() * 4));
    const chunk = Array.from({ length: Math.floor(random() * 13) }, () => ['a', 'b', ASTRAL, 'é'][Math.floor(random() * 4)]).join('');
    const joined = head + chunk;
    const capped = appendCapped(head, chunk);
    assert.ok(joined.startsWith(capped), 'prefix');
    assert.ok(capped.isWellFormed(), `well formed: ${JSON.stringify(chunk)}`);
    assert.ok(capped.length <= LIMIT && capped.length >= Math.min(joined.length, LIMIT - 1));
    if (joined.length <= LIMIT) assert.equal(capped, joined);
  }
  assert.equal(appendCapped('a'.repeat(LIMIT - 1), ASTRAL).length, LIMIT - 1, 'a split pair is dropped');
});

function headerFetch(seen) {
  return async (_url, init) => {
    seen.push(init.headers);
    return new Response('', { status: 200 });
  };
}

test('property: an http header gets only the allowed variables, and a value with no $ is unchanged', async () => {
  const random = rng(1302);
  const names = ['A1', 'B2', 'C_3'];
  const env = { A1: 'x1', B2: 'y2', C_3: 'z3' };
  const noWarn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 150; i += 1) {
      const allowed = names.filter(() => random() < 0.5);
      let template = '';
      let expected = '';
      for (let part = 0; part < 4; part += 1) {
        if (random() < 0.5) {
          // A leading space ends a bare $NAME, which would otherwise read the literal as more of the name.
          const literal = ` ${textFrom(random, 'ab -:', 5)}`;
          template += literal;
          expected += literal;
        } else {
          const name = names[Math.floor(random() * 3)];
          template += random() < 0.5 ? `$${name}` : `\${${name}}`;
          expected += allowed.includes(name) ? env[name] : '';
        }
      }
      const seen = [];
      const hook = { url: 'https://h.test/x', headers: { 'x-test': template }, allowedEnvVars: allowed };
      await runHttpHook(hook, '{}', { env, fetchImpl: headerFetch(seen) });
      assert.equal(seen[0]['x-test'], expected, JSON.stringify({ template, allowed }));
    }
  } finally {
    console.warn = noWarn;
  }
});

test('property: an http response is a failure unless it is 2xx with an empty body or a JSON object', async () => {
  const random = rng(1303);
  const bodies = ['', '  \n', '{"a":1}', ' {"decision":"block"} ', '[1]', 'null', '7', 'text', '{', '"s"'];
  for (let i = 0; i < 200; i += 1) {
    const status = 100 + Math.floor(random() * 500);
    const body = bodies[Math.floor(random() * bodies.length)];
    const noBody = status === 204 || status === 205 || status === 304 || status < 200;
    const response = () => new Response(noBody ? null : body, { status: status < 200 ? 200 : status });
    const run = await runHttpHook({ url: 'https://h.test/x' }, '{}', { fetchImpl: async () => response() });
    const realStatus = status < 200 ? 200 : status;
    const text = noBody ? '' : body.trim();
    const isObject = text.startsWith('{') && (() => { try { return typeof JSON.parse(text) === 'object'; } catch { return false; } })();
    const ok = realStatus >= 200 && realStatus < 300 && (text === '' || isObject);
    assert.equal(!run.failed, ok, JSON.stringify({ realStatus, body }));
    if (ok) assert.equal(run.stdout, text);
    else assert.ok(typeof run.reason === 'string' && run.reason !== '');
  }
});

test('property: readBody refuses the same bodies on the stream path and on the text path', async () => {
  const random = rng(1304);
  for (const [char, width] of [['a', 1], ['é', 2], ['€', 3], [ASTRAL, 4]]) {
    for (const delta of [-1, 0, 1]) {
      const count = Math.floor(LIMIT / width) + delta;
      const body = char.repeat(count);
      const tooLarge = count * width > LIMIT;
      const viaStream = await runHttpHook({ url: 'https://h.test/x' }, '{}', {
        fetchImpl: async () => new Response(body, { status: 200 }),
      });
      const viaText = await runHttpHook({ url: 'https://h.test/x' }, '{}', {
        fetchImpl: async () => ({ status: 200, headers: { get: () => null }, text: async () => body }),
      });
      for (const run of [viaStream, viaText]) {
        assert.equal(/too large/.test(run.reason ?? ''), tooLarge, `${width}-byte char, delta ${delta}`);
      }
    }
  }
  // A character split across two chunks stays whole.
  for (let i = 0; i < 100; i += 1) {
    const json = JSON.stringify({ text: textFrom(random, `ab${ASTRAL}é€`, 12) });
    const bytes = new TextEncoder().encode(json);
    const cut = Math.floor(random() * (bytes.length + 1));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const run = await runHttpHook({ url: 'https://h.test/x' }, '{}', { fetchImpl: async () => new Response(stream, { status: 200 }) });
    assert.equal(run.stdout, json, `cut at ${cut}`);
  }
});

test('a Content-Length that is not plain digits is not a length', async () => {
  for (const header of ['0x10', '1e9', ' ', 'NaN', '-5']) {
    const response = { status: 200, headers: { get: () => header }, text: async () => '' };
    const run = await runHttpHook({ url: 'https://h.test/x' }, '{}', { fetchImpl: async () => response });
    assert.equal(run.failed, false, header);
  }
  const big = { status: 200, headers: { get: () => String(LIMIT + 1) }, text: async () => '' };
  assert.match((await runHttpHook({ url: 'https://h.test/x' }, '{}', { fetchImpl: async () => big })).reason, /too large/);
});

test('property: a deny message survives the round trip through denyRun and interpretRun', () => {
  const random = rng(1305);
  for (let i = 0; i < RUNS; i += 1) {
    const message = textFrom(random, `ab "\\\n\t${ASTRAL}é `, 20);
    const outcome = interpretRun('permission-request', 'PermissionRequest', denyRun(message));
    assert.deepEqual(outcome.specific.decision, { behavior: 'deny', message }, JSON.stringify(message));
  }
});

test('property: a block verdict still blocks, or still reaches the model, on each event that can block', () => {
  const random = rng(1306);
  const events = {
    'user-prompt-submit': 'UserPromptSubmit', 'pre-tool-use': 'PreToolUse', 'post-tool-use': 'PostToolUse',
    'post-tool-batch': 'PostToolBatch', 'subagent-stop': 'SubagentStop', 'task-created': 'TaskCreated',
    'task-completed': 'TaskCompleted', stop: 'Stop', 'config-change': 'ConfigChange', 'pre-compact': 'PreCompact',
  };
  for (let i = 0; i < RUNS; i += 1) {
    const reason = `r${textFrom(random, 'ab c', 10)}`;
    const [event, claude] = Object.entries(events)[Math.floor(random() * 10)];
    for (const hook of [{ type: 'prompt' }, { type: 'agent' }]) {
      const outcome = interpretRun(event, claude, verdictToRun(event, { ok: false, reason }, hook));
      assert.equal(outcome.blocked, true, event);
      assert.equal(interpretRun(event, claude, verdictToRun(event, { ok: true }, hook)).blocked, false, event);
    }
  }
  const denied = interpretRun('permission-request', 'PermissionRequest', verdictToRun('permission-request', { ok: false, reason: 'no' }, { type: 'prompt' }));
  assert.equal(denied.specific.decision.behavior, 'deny');
  const failure = interpretRun('post-tool-use-failure', 'PostToolUseFailure', verdictToRun('post-tool-use-failure', { ok: false, reason: 'why' }, { type: 'prompt' }));
  assert.deepEqual(failure.contexts, ['why']);
});

test('property: the first PermissionRequest deny decision stays, in any order', () => {
  const random = rng(1307);
  const ask = (behavior, message) => interpretRun('permission-request', 'PermissionRequest', {
    exitCode: 0, failed: false,
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, message } } }),
  });
  for (let i = 0; i < RUNS; i += 1) {
    const list = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, n) => ask(random() < 0.5 ? 'deny' : 'allow', `m${n}`));
    const merged = mergeOutcomes(list);
    const firstDeny = list.find((outcome) => outcome.specific.decision.behavior === 'deny');
    if (firstDeny === undefined) assert.equal(merged.specific.decision.behavior, 'allow');
    else assert.deepEqual(merged.specific.decision, firstDeny.specific.decision);
  }
});

test('property: blocksToText is the text of the text blocks, in order, and ignores every other block', () => {
  const random = rng(1308);
  for (let i = 0; i < RUNS; i += 1) {
    const blocks = Array.from({ length: Math.floor(random() * 6) }, () => {
      const kind = Math.floor(random() * 4);
      const text = textFrom(random, 'ab c', 5);
      if (kind === 0) return { type: 'text', text };
      if (kind === 1) return { type: 'image', text };
      if (kind === 2) return { type: 'text', text: 5 };
      return null;
    });
    const expected = blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
    assert.equal(blocksToText(blocks), expected);
  }
  assert.equal(blocksToText(undefined), '');
});

test('property: failureText is never empty', () => {
  const random = rng(1309);
  const parts = [undefined, '', 'boom'];
  for (let i = 0; i < RUNS; i += 1) {
    const result = {
      content: random() < 0.5 ? [{ type: 'text', text: parts[Math.floor(random() * 3)] ?? '' }] : undefined,
      error: random() < 0.7 ? { message: parts[Math.floor(random() * 3)], code: parts[Math.floor(random() * 3)] } : undefined,
    };
    assert.notEqual(failureText(result), '', JSON.stringify(result));
  }
});

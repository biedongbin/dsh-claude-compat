// Hook matchers (compileMatcher in src/hook-engine.js), per the Claude Code docs,
// "Matcher patterns".
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMatcher } from '../src/hook-engine.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeAgent, harness, tempDir, withWarnings } from './hook-kit.js';

test('"*", an empty string and a blank string match every name', () => {
  for (const matcher of ['*', '', '   ']) {
    assert.equal(compileMatcher(matcher)('anything'), true, JSON.stringify(matcher));
    assert.equal(compileMatcher(matcher)(''), true);
  }
});

test('letters, digits, underscore and hyphen make an exact name, not a pattern', () => {
  const bash = compileMatcher('Bash');
  assert.equal(bash('Bash'), true);
  assert.equal(bash('NotBash'), false);
  assert.equal(bash('Bash2'), false);
  assert.equal(compileMatcher('code-reviewer')('code-reviewer'), true);
  assert.equal(compileMatcher('code-reviewer')('code-reviewers'), false);
});

test('a list of exact names splits on | or comma, with optional spaces', () => {
  for (const matcher of ['Edit|Write', 'Edit, Write', 'Edit,Write', ' Edit | Write ']) {
    const either = compileMatcher(matcher);
    assert.equal(either('Edit'), true, matcher);
    assert.equal(either('Write'), true, matcher);
    assert.equal(either('Read'), false, matcher);
    assert.equal(either('NotebookEdit'), false, matcher);
  }
});

test('any other character makes an unanchored regular expression', () => {
  assert.equal(compileMatcher('^Notebook')('NotebookEdit'), true);
  assert.equal(compileMatcher('^Notebook')('MyNotebook'), false);
  assert.equal(compileMatcher('Edit.*')('NotebookEdit'), true, 'unanchored: matches inside the name');
  assert.equal(compileMatcher('^Edit$')('NotebookEdit'), false);
  assert.equal(compileMatcher('mcp__memory__.*')('mcp__memory__store'), true);
  assert.equal(compileMatcher('mcp__memory__.*')('mcp__other__store'), false);
});

test('.*opus.* matches a name that starts with opus', () => {
  const opus = compileMatcher('.*opus.*');
  assert.equal(opus('opus-5'), true);
  assert.equal(opus('claude-opus-5'), true);
  assert.equal(opus('sonnet'), false);
});

test('a name with a hyphen in an exact list matches exactly', () => {
  assert.equal(compileMatcher('claude-opus-4-6|claude-opus-5')('claude-opus-5'), true);
  assert.equal(compileMatcher('claude-opus-4-6|claude-opus-5')('claude-opus-4'), false);
});

test('the narrow rule, for FileChanged and StopFailure, treats hyphen, space and comma as a pattern', () => {
  const narrow = (matcher) => compileMatcher(matcher, { narrow: true });
  assert.equal(narrow('rate_limit|server_error')('server_error'), true);
  assert.equal(narrow('.envrc|.env')('.env'), true, 'a dot is already a pattern, so this is a regular expression');
  assert.equal(narrow('a-b')('xa-by'), true, 'a hyphen sends the matcher to the regular expression path, which is unanchored');
  assert.equal(compileMatcher('a-b')('xa-by'), false, 'the normal rule keeps a hyphen in an exact name');
  assert.equal(narrow('a,b')('a'), false, 'a comma does not separate names here');
});

test('a regular expression that does not parse never matches, and says why', () => {
  const broken = compileMatcher('[');
  assert.equal(broken('['), false);
  assert.equal(broken('x'), false);
  assert.match(broken.invalid, /Invalid regular expression/);
});

test('a matcher that is not a string never matches', () => {
  for (const value of [undefined, null, 5, {}, ['Bash']]) assert.equal(compileMatcher(value)('Bash'), false);
});

test('the engine warns once for a pattern that does not parse, and its hook never runs', async () => {
  const h = harness({ PreToolUse: [{ matcher: '[', hooks: [{ command: 'exit 2' }] }] });
  const { value, warnings } = await withWarnings(async () => {
    const agent = fakeAgent();
    const call = { name: '[', arguments: {}, callId: 'c', agent };
    const first = await h.dispatch('tools/pre-execute', [call], async () => ({ kind: 'allow' }));
    await h.dispatch('tools/pre-execute', [call], async () => ({ kind: 'allow' }));
    return first;
  });
  assert.equal(value.kind, 'allow');
  assert.equal(warnings.filter((line) => /not a valid regular expression/.test(line)).length, 1);
});

test('the engine uses the narrow rule for StopFailure, so a comma does not separate error types', async () => {
  const file = join(tempDir('dcc-matcher-'), 'ran');
  const h = harness({ StopFailure: [{ matcher: 'rate_limit,billing_error', hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const error = Object.assign(new Error('x'), { name: 'LlmError', code: 'QUOTA' });
  h.dispatch('agent/error', [{ agent: fakeAgent(), turn: 1, step: 0, error }], () => {});
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});

// Pure rules for MCP allow and deny lists (src/mcp-policy.js) and ${VAR} expansion
// (src/mcp-vars.js). The URL rows are the examples in Claude Code's managed-MCP docs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { policyVerdict, urlMatches } from '../src/mcp-policy.js';
import { expandVars } from '../src/mcp-vars.js';

const rows = [
  ['https://mcp.example.com/*', 'https://mcp.example.com/api', true],
  ['https://mcp.example.com/*', 'https://mcp.example.com:8443/api', false],
  ['https://mcp.example.com', 'https://mcp.example.com/any/path', true],
  ['https://mcp.example.com:8443/*', 'https://mcp.example.com:8443/x', true],
  ['https://mcp.example.com:8443/*', 'https://mcp.example.com/x', false],
  ['https://mcp.example.com:*/*', 'https://mcp.example.com:9000/x', true],
  ['https://mcp.example.com:*/*', 'https://mcp.example.com/x', true],
  ['https://*.example.com/*', 'https://api.example.com:9000/x', true],
  ['https://*.example.com/*', 'https://example.org/x', false],
  ['http://localhost:*/*', 'http://localhost:4000/mcp', true],
  ['*://mcp.example.com/*', 'http://mcp.example.com/x', true],
  ['*://mcp.example.com/*', 'http://mcp.example.com:8080/x', false],
  ['https://Mcp.Example.com/*', 'https://mcp.example.com/api', true],
  ['https://mcp.example.com/api', 'https://mcp.example.com/API', false],
];

test('urlMatches follows the documented port, host, scheme and path rules', () => {
  for (const [pattern, url, expected] of rows) {
    assert.equal(urlMatches(pattern, url), expected, `${pattern} vs ${url}`);
  }
});

test('urlMatches is false for a url that does not parse, or a pattern with no scheme', () => {
  assert.equal(urlMatches('https://x.example/*', 'not a url'), false);
  assert.equal(urlMatches('x.example/*', 'https://x.example/api'), false);
});

test('a denylist match blocks a server even when the allowlist allows it', () => {
  const policy = { allowed: [{ serverUrl: 'https://a.example/*' }], denied: [{ serverUrl: 'https://a.example/*' }] };
  assert.equal(policyVerdict({ label: 'x', url: 'https://a.example/mcp' }, policy), 'denied by policy');
});

test('a URL allowlist blocks a stdio server, and a name entry is used only when no URL entry exists', () => {
  const urlOnly = { allowed: [{ serverUrl: 'https://a.example/*' }, { serverName: 'named' }], denied: [] };
  // No serverCommand entries exist, so the name entry applies to a stdio server.
  assert.equal(policyVerdict({ label: 'named', command: 'run', args: [] }, urlOnly), undefined);
  assert.equal(policyVerdict({ label: 'other', command: 'run', args: [] }, urlOnly), 'not allowed by policy');
  assert.equal(policyVerdict({ label: 'named', url: 'https://b.example/mcp' }, urlOnly), 'not allowed by policy');
  const nameOnly = { allowed: [{ serverName: 'named' }], denied: [] };
  assert.equal(policyVerdict({ label: 'named', command: 'run', args: [] }, nameOnly), undefined);
});

test('a command entry matches the exact command and arguments, in order', () => {
  const policy = { allowed: [{ serverCommand: ['npx', '-y', 'pkg'] }], denied: [] };
  assert.equal(policyVerdict({ label: 'a', command: 'npx', args: ['-y', 'pkg'] }, policy), undefined);
  assert.equal(policyVerdict({ label: 'a', command: 'npx', args: ['pkg'] }, policy), 'not allowed by policy');
  assert.equal(policyVerdict({ label: 'a', command: 'npx', args: ['-y', 'pkg', '--flag'] }, policy), 'not allowed by policy');
});

test('an empty allowlist blocks every server that is not skipping the check', () => {
  const policy = { allowed: [], denied: [] };
  assert.equal(policyVerdict({ label: 'a', url: 'https://a.example/mcp' }, policy), 'not allowed by policy');
  assert.equal(policyVerdict({ label: 'a', url: 'https://a.example/mcp', skipAllowlist: true }, policy), undefined);
});

test('no allowlist at all allows every server', () => {
  assert.equal(policyVerdict({ label: 'a', command: 'run', args: [] }, { allowed: undefined, denied: [] }), undefined);
});

test('a serverName denial blocks any source with that name', () => {
  const policy = { allowed: undefined, denied: [{ serverName: 'claude.ai Slack' }] };
  assert.equal(policyVerdict({ label: 'claude.ai Slack', url: 'https://slack.example/mcp' }, policy), 'denied by policy');
  assert.equal(policyVerdict({ label: 'slack', url: 'https://slack.example/mcp' }, policy), undefined);
});

test('expandVars handles a set, an empty, a defaulted and an unset variable', () => {
  const unset = [];
  const onUnset = (name) => unset.push(name);
  const vars = { SET: 'v', EMPTY: '' };
  assert.equal(expandVars('${SET}', vars, onUnset), 'v');
  assert.equal(expandVars('${EMPTY:-d}', vars, onUnset), '');
  assert.equal(expandVars('${NOPE:-d}', vars, onUnset), 'd');
  assert.equal(expandVars('${NOPE:-}', vars, onUnset), '');
  assert.equal(expandVars('${NOPE}', vars, onUnset), '${NOPE}');
  assert.deepEqual(unset, ['NOPE']);
});

test('expandVars does not read inherited object keys as variables', () => {
  const unset = [];
  assert.equal(expandVars('${constructor}', {}, (name) => unset.push(name)), '${constructor}');
  assert.deepEqual(unset, ['constructor']);
});

test('expandVars leaves a value with no placeholder, or a non-string, unchanged', () => {
  assert.equal(expandVars('plain', {}, () => {}), 'plain');
  assert.equal(expandVars(42, {}, () => {}), 42);
});

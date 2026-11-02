// Property tests for the MCP parsers and the policy. Random input comes from a
// fixed seed, so a failure repeats exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPolicy, policyVerdict, urlMatches } from '../src/mcp-policy.js';
import { expandVars } from '../src/mcp-vars.js';
import { translateMcpServers } from '../src/mcp.js';

const RUNS = 300;

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

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function textFrom(random, alphabet, max) {
  const length = Math.floor(random() * (max + 1));
  let text = '';
  for (let i = 0; i < length; i += 1) text += pick(random, [...alphabet]);
  return text;
}

// A random JSON value, including the wrong shapes a settings file can hold.
function jsonValue(random, depth = 0) {
  const choice = random();
  if (depth > 2 || choice < 0.4) return pick(random, [null, true, 7, 'x', '', 'https://a.example/*', []]);
  if (choice < 0.6) return Array.from({ length: 1 + Math.floor(random() * 3) }, () => jsonValue(random, depth + 1));
  const keys = ['serverName', 'serverUrl', 'serverCommand', 'other'];
  const object = {};
  for (const key of keys) if (random() < 0.4) object[key] = jsonValue(random, depth + 1);
  return object;
}

const URL_CHARS = 'abcxyz019-._~';

test('a URL pattern matches the URL it was written from, with any query or fragment', () => {
  const random = rng(11);
  for (let i = 0; i < RUNS; i += 1) {
    const host = `${textFrom(random, 'abcxyz', 8) || 'h'}.example`;
    const path = `/${textFrom(random, URL_CHARS, 12)}`;
    const query = random() < 0.5 ? `?${textFrom(random, URL_CHARS, 8)}=${textFrom(random, URL_CHARS, 6)}` : '';
    const url = `https://${host}${path}${query}`;
    assert.equal(urlMatches(url, url), true, url);
  }
});

test('a denied URL is denied, even when it carries a query string', () => {
  const random = rng(12);
  for (let i = 0; i < RUNS; i += 1) {
    const url = `https://evil${i}.example/mcp?token=${textFrom(random, URL_CHARS, 10)}`;
    const verdict = policyVerdict({ label: 'x', url }, buildPolicy({ userSettings: { value: { deniedMcpServers: [{ serverUrl: url }] } } }, {}));
    assert.equal(verdict, 'denied by policy', url);
  }
});

test('a pattern with no query matches the path, whatever query the server URL carries', () => {
  const random = rng(13);
  for (let i = 0; i < RUNS; i += 1) {
    const path = `/${textFrom(random, URL_CHARS, 10)}`;
    const query = `?${textFrom(random, URL_CHARS, 10)}`;
    assert.equal(urlMatches(`https://q.example${path}`, `https://q.example${path}${query}`), true);
  }
});

test('buildPolicy and policyVerdict never throw on malformed policy values', () => {
  const random = rng(14);
  for (let i = 0; i < RUNS; i += 1) {
    const docs = {
      managedSettings: { value: { allowedMcpServers: jsonValue(random), deniedMcpServers: jsonValue(random), allowManagedMcpServersOnly: jsonValue(random) } },
      userSettings: { value: { deniedMcpServers: jsonValue(random), allowedMcpServers: jsonValue(random) } },
    };
    const policy = buildPolicy(docs, {});
    const server = { label: 'l', url: 'https://a.example/mcp', skipAllowlist: random() < 0.5 };
    const verdict = policyVerdict(server, policy);
    assert.ok(verdict === undefined || typeof verdict === 'string');
  }
});

test('a denied server is never allowed, whatever the allowlist says', () => {
  const random = rng(15);
  for (let i = 0; i < RUNS; i += 1) {
    const url = `https://d${i}.example/mcp`;
    const docs = { userSettings: { value: { deniedMcpServers: [{ serverUrl: url }], allowedMcpServers: [{ serverUrl: url }] } } };
    const server = { label: 'd', url, skipAllowlist: random() < 0.5 };
    assert.equal(policyVerdict(server, buildPolicy(docs, {})), 'denied by policy');
  }
});

test('expandVars is single-pass: a value that holds ${X} comes through literally', () => {
  const random = rng(16);
  for (let i = 0; i < RUNS; i += 1) {
    const name = `V${Math.floor(random() * 1000)}`;
    const inner = `\${${textFrom(random, 'ABCDEF', 4) || 'Z'}}`;
    assert.equal(expandVars(`\${${name}}`, { [name]: inner }, () => {}), inner);
  }
});

test('translateMcpServers never throws on a random .mcp.json body, and every server is a known transport', () => {
  const random = rng(17);
  for (let i = 0; i < RUNS; i += 1) {
    const body = JSON.stringify({ mcpServers: { [textFrom(random, 'ab-_. ', 6) || 'n']: jsonValue(random) } });
    const result = translateMcpServers(body);
    for (const server of result.servers) {
      assert.ok(['stdio', 'streamable-http'].includes(server.transport), body);
    }
  }
});

test('translateMcpServers never throws on a random body that is not even JSON', () => {
  const random = rng(18);
  for (let i = 0; i < RUNS; i += 1) {
    const result = translateMcpServers(textFrom(random, '{}[]":,\\ a1', 30));
    assert.deepEqual(result.servers, []);
    assert.equal(result.warns.length > 0, true);
  }
});

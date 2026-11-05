// Property tests for the MCP parsers and the policy. Random input comes from a
// fixed seed, so a failure repeats exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPolicy, policyVerdict, urlMatches } from '../src/mcp-policy.js';
import { credentialNames, expandVars, redactValues, scrubbedEnv } from '../src/mcp-vars.js';
import { translateMcpServers } from '../src/mcp.js';
import { translatePluginMcp } from '../src/plugins.js';
import { selectEntries } from '../src/mcp-sources.js';

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

// ─── review: variables, the scrub, plugin paths, URL spellings, source merge ───

const IDENT_START = 'ABCxyz_';
const IDENT_REST = 'ABCxyz_019';

function identifier(random) {
  return pick(random, [...IDENT_START]) + textFrom(random, IDENT_REST, 8);
}

test('expandVars: a default is used for an unset name, a bare unset name stays and is reported once', () => {
  const random = rng(31);
  for (let i = 0; i < RUNS; i += 1) {
    const name = identifier(random);
    const fallback = textFrom(random, 'ab c-./:', 8);
    assert.equal(expandVars(`<\${${name}:-${fallback}}>`, {}, () => assert.fail('no report')), `<${fallback}>`);
    const seen = [];
    assert.equal(expandVars(`\${${name}}`, {}, (unset) => seen.push(unset)), `\${${name}}`);
    assert.deepEqual(seen, [name]);
    const plain = textFrom(random, 'ab c-./:{}$', 10).replace(/\$\{/g, '$');
    assert.equal(expandVars(plain, { [name]: 'v' }, () => assert.fail('no report')), plain);
  }
});

const ENV_NAMES = ['PATH', 'HOME', 'MY_TOKEN', 'api_key', 'DB_PASSPHRASE', 'AWS_CREDS', 'SESSION_COOKIE', 'SENTRY_DSN',
  'GIT_CONFIG_KEY_0', 'GIT_CONFIG_KEY_12', 'ANTHROPIC_CUSTOM_HEADERS', 'LANG', 'DATABASE_URL', 'EDITOR', 'GH_AUTH'];

function randomEnv(random) {
  const env = {};
  for (const name of ENV_NAMES) {
    if (random() < 0.7) env[name] = pick(random, ['', 'x1', 'postgres://u:pw@h/db', 'plain-value', 'v2']);
  }
  return env;
}

test('scrubbedEnv splits an environment: every name is kept or removed, and a removed value is redacted', () => {
  const random = rng(32);
  for (let i = 0; i < RUNS; i += 1) {
    const env = randomEnv(random);
    const { env: kept, removed } = scrubbedEnv(env);
    const dropped = credentialNames(env);
    assert.deepEqual([...Object.keys(kept), ...dropped].sort(), Object.keys(env).sort());
    for (const name of dropped) assert.equal(Object.hasOwn(kept, name), false);
    assert.ok(Object.keys(kept).every((name) => /^GIT_CONFIG_KEY_/.test(name) || !/TOKEN|SECRET|PASS|KEY|AUTH|CRED|COOKIE|DSN/i.test(name)));
    assert.ok(removed.every((value) => value !== ''));
    const text = Object.values(env).join('|');
    const clean = redactValues(text, removed);
    for (const value of removed) assert.equal(clean.includes(value), false, value);
  }
  assert.equal(redactValues('abc', ['']), 'abc');
  assert.equal(scrubbedEnv({ DATABASE_URL: 'postgres://u:pw@h/db', HOME: '/h' }).env.DATABASE_URL, undefined);
});

test('translatePluginMcp: the install path is a value, so no spelling of it is expanded or turned into a pattern', () => {
  const random = rng(33);
  for (let i = 0; i < RUNS; i += 1) {
    const dir = `/opt/${textFrom(random, 'ab "\\$&\'`{}HOME', 14)}${pick(random, ['', '${HOME}', '${CLAUDE_PLUGIN_ROOT}', '$&', "$'", '$$', '\\'])}/p`;
    const manifest = { mcpServers: { a: { command: '${CLAUDE_PLUGIN_ROOT}/bin/run', args: ['${CLAUDE_PLUGIN_ROOT}'], cwd: '${CLAUDE_PLUGIN_ROOT}' } } };
    const { servers, warns } = translatePluginMcp(manifest, dir, {});
    assert.equal(servers.length, 1, JSON.stringify(dir));
    assert.equal(servers[0].command, `${dir}/bin/run`);
    assert.deepEqual(servers[0].args, [dir]);
    assert.equal(servers[0].cwd, dir);
    assert.deepEqual(warns, []);
  }
});

test('translateMcpServers: names and servers stay aligned, and a sanitized name is one safe segment', () => {
  const random = rng(34);
  for (let i = 0; i < RUNS; i += 1) {
    const map = {};
    for (let n = 0; n < 1 + Math.floor(random() * 4); n += 1) {
      const key = textFrom(random, 'ab .:/é-_9', 40) || 'k';
      map[key] = random() < 0.2 ? pick(random, [null, [], 'x', 5]) : { type: 'stdio', command: 'c' };
    }
    const { servers, names } = translateMcpServers(JSON.stringify({ mcpServers: map }));
    assert.equal(servers.length, names.length);
    names.forEach((name, index) => {
      assert.ok(Object.hasOwn(map, name));
      assert.match(servers[index].serverName, /^[A-Za-z0-9_-]{1,32}$/);
    });
  }
});

test('urlMatches: a pattern gives one verdict for equivalent spellings of the same URL', () => {
  const random = rng(35);
  for (let i = 0; i < RUNS; i += 1) {
    const host = `${textFrom(random, 'abcxyz', 6) || 'h'}.example`;
    const segments = Array.from({ length: 1 + Math.floor(random() * 3) }, () => textFrom(random, 'abcxyz019-._~', 6) || 's');
    const plain = `https://${host}/${segments.join('/')}`;
    const encoded = `https://${host.toUpperCase()}/${segments.map((part) => [...part].map((char) => (
      /[a-z0-9]/.test(char) && random() < 0.5 ? `%${char.charCodeAt(0).toString(16).toUpperCase()}` : char)).join('')).join('/./')}`;
    for (const pattern of [`https://${host}/${segments.join('/')}`, `https://${host}/*`, `*://${host}:*/${segments[0]}*`, `https://other.example/*`]) {
      assert.equal(urlMatches(pattern, encoded), urlMatches(pattern, plain), JSON.stringify({ pattern, encoded }));
    }
  }
});

test('selectEntries: names are unique, a disabled name never survives, and exclusive control keeps managed entries only', () => {
  const random = rng(36);
  const names = ['a', 'b', 'c', 'd'];
  const serverMap = () => Object.fromEntries(names.filter(() => random() < 0.6).map((name) => [name, { type: 'stdio', command: name }]));
  for (let i = 0; i < RUNS; i += 1) {
    const off = names.filter(() => random() < 0.3);
    const exclusive = random() < 0.3;
    const docs = {
      cwd: '/w',
      claudeJson: { value: { mcpServers: serverMap(), projects: { '/w': { mcpServers: serverMap() } } } },
      projectMcp: { value: { mcpServers: serverMap() } },
      projectSettings: { value: { disabledMcpjsonServers: off } },
      managedMcp: exclusive ? { value: { mcpServers: serverMap() } } : undefined,
    };
    const { entries, exclusive: flagged } = selectEntries(docs);
    assert.equal(flagged, exclusive);
    const seen = entries.map((entry) => entry.name);
    assert.equal(new Set(seen).size, seen.length);
    for (const entry of entries) {
      if (entry.scope === 'project') assert.equal(off.includes(entry.name), false);
      if (exclusive) assert.ok(entry.scope.startsWith('managed'), entry.scope);
    }
  }
});

// allowedMcpServers and deniedMcpServers, as Claude Code applies them. The
// denylist merges from every settings scope and always wins. The allowlist
// merges too, unless managed settings set allowManagedMcpServersOnly. A list
// that is present but not a list counts as an empty list, so the allowlist fails
// closed. A malformed entry is ignored with a warning, so the rest still applies.
// A malformed managed policy is worse: it turns every MCP server off (failClosed).

import { docValue } from './lib.js';
import { expandVars } from './mcp-vars.js';

const DEFAULT_PORT = new Map([['http', '80'], ['https', '443']]);
const ENTRY_KEYS = ['serverName', 'serverUrl', 'serverCommand'];
const SCOPES = [
  ['managedSettings', 'managed settings'],
  ['userSettings', 'user settings'],
  ['projectSettings', 'project settings'],
  ['localSettings', 'local settings'],
];

// Escape a glob where `*` is the only wildcard.
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// Resolve dot segments and escapes the way a URL does, so the pattern compares
// with the same text as the server URL. `/./a` and `/a` are one path.
function normalizePath(path) {
  try {
    const url = new URL(`http://pattern.invalid${path}`);
    return path.includes('?') ? `${url.pathname}${url.search}` : url.pathname;
  } catch {
    return path;
  }
}

// A host is compared in the ASCII form that URL() gives it, so `bücher.example`
// matches its punycode form. A pattern with `*` does not parse as a host, and is
// only lowercased.
function normalizeHost(host) {
  try {
    return new URL(`http://${host}`).hostname.replace(/\.$/, '');
  } catch {
    return host.toLowerCase().replace(/\.$/, '');
  }
}

// A host with `*` is a wildcard and is not parsed. Any other host must parse, so a
// pattern that cannot match any real host is reported, not left to match nothing.
function hostParses(host) {
  if (host.includes('*')) return true;
  try {
    new URL(`http://${host}`);
    return true;
  } catch {
    return false;
  }
}

// Split `scheme://host[:port][/path]` into its parts. The fragment is dropped,
// because a browser never sends it to the server. Returns undefined on a bad shape.
function parseUrlPattern(pattern) {
  const shape = /^([^:/]+):\/\/([^/]*)(\/.*)?$/.exec(pattern);
  if (shape === null) return undefined;
  const [, scheme, authority, rawPath] = shape;
  const colon = authority.lastIndexOf(':');
  const portPart = colon === -1 ? undefined : authority.slice(colon + 1);
  const hasPort = portPart !== undefined && /^([0-9]+|\*)$/.test(portPart);
  return {
    scheme,
    host: normalizeHost(hasPort ? authority.slice(0, colon) : authority),
    port: hasPort ? portPart : undefined,
    path: rawPath === undefined ? undefined : normalizePath(rawPath.split('#')[0]),
  };
}

function portAllowed(parsed, effectivePort, scheme) {
  if (parsed.port === '*') return true;
  if (parsed.port !== undefined) return parsed.port === effectivePort;
  if (parsed.host.includes('*')) return true;
  return effectivePort === DEFAULT_PORT.get(scheme);
}

// Port rules follow the managed-MCP docs. A host written out in full allows only
// the scheme's default port. A `*` in the host, or a `*` port, allows any port.
// A pattern with no path allows any path. A pattern with a query string must match
// the query too. A pattern without one matches the path only.
export function urlMatches(pattern, url) {
  const parsed = parseUrlPattern(pattern);
  let actual;
  try { actual = new URL(url); } catch { return false; }
  if (parsed === undefined) return false;
  const scheme = actual.protocol.slice(0, -1);
  if (parsed.scheme !== '*' && parsed.scheme.toLowerCase() !== scheme) return false;
  if (!globToRegExp(parsed.host).test(normalizeHost(actual.hostname))) return false;
  const effectivePort = actual.port !== '' ? actual.port : (DEFAULT_PORT.get(scheme) ?? '');
  if (!portAllowed(parsed, effectivePort, scheme)) return false;
  if (parsed.path === undefined || parsed.path === '') return true;
  const target = parsed.path.includes('?') ? `${actual.pathname}${actual.search}` : actual.pathname;
  return globToRegExp(parsed.path).test(target);
}

// One policy entry against one server. `server` carries `label` (the name the
// user gave it), and either `url` or `command` with `args`.
function entryMatches(entry, server) {
  if ('serverName' in entry) return entry.serverName === server.label;
  if ('serverUrl' in entry) return server.url !== undefined && urlMatches(entry.serverUrl, server.url);
  const actual = [server.command, ...(server.args ?? [])];
  return server.command !== undefined && entry.serverCommand.length === actual.length
    && entry.serverCommand.every((part, i) => part === actual[i]);
}

// Return the reason a server is blocked, or undefined when it may load.
// `skipAllowlist` marks the organization's own servers, which skip the allowlist.
export function policyVerdict(server, policy) {
  if (policy.denied.some((entry) => entryMatches(entry, server))) return 'denied by policy';
  if (policy.allowed === undefined || server.skipAllowlist === true) return undefined;
  const remote = server.url !== undefined;
  const kind = remote ? 'serverUrl' : 'serverCommand';
  const hasKind = policy.allowed.some((entry) => kind in entry);
  const allowed = policy.allowed.some((entry) => {
    if (kind in entry) return entryMatches(entry, server);
    return !hasKind && 'serverName' in entry && entryMatches(entry, server);
  });
  return allowed ? undefined : 'not allowed by policy';
}

// Return the problem with one entry, or undefined when the entry is well formed.
function entryProblem(entry) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return 'not an object';
  const keys = Object.keys(entry).filter((key) => ENTRY_KEYS.includes(key));
  if (keys.length !== 1) return 'needs exactly one of serverName, serverUrl or serverCommand';
  if (keys[0] === 'serverName') {
    return typeof entry.serverName === 'string' && entry.serverName.length > 0
      ? undefined : 'serverName must be a non-empty string';
  }
  if (keys[0] === 'serverUrl') {
    if (typeof entry.serverUrl !== 'string') return 'serverUrl must be a string';
    const parsed = parseUrlPattern(entry.serverUrl);
    if (parsed === undefined) return 'serverUrl is not a URL pattern';
    return hostParses(parsed.host) ? undefined : 'serverUrl has a host that is not valid';
  }
  const command = entry.serverCommand;
  const ok = Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === 'string');
  return ok ? undefined : 'serverCommand must be a non-empty list of strings';
}

// Expand ${VAR} in a policy entry. Policy entries expand from the process
// environment. Claude Code pins that environment, so a settings file cannot change
// what an entry means. An unset variable keeps its literal text, and `onUnset` reports it.
function expandEntry(entry, vars, onUnset) {
  if ('serverUrl' in entry) return { serverUrl: expandVars(entry.serverUrl, vars, onUnset) };
  if ('serverCommand' in entry) {
    return { serverCommand: entry.serverCommand.map((part) => expandVars(part, vars, onUnset)) };
  }
  return entry;
}

// Keep the well-formed entries of one list, expanded. Each problem is reported with
// the list name and the position, so the reader can find the entry.
function validEntries(list, where, warns, vars) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    warns.push(`${where} must be a list. It is treated as an empty list.`);
    return [];
  }
  const onUnset = (name) => warns.push(`${where}: \${${name}} is not set, so the entry keeps the literal text`);
  return list.flatMap((entry, index) => {
    const problem = entryProblem(entry);
    if (problem === undefined) return [expandEntry(entry, vars, onUnset)];
    warns.push(`${where}[${index}]: ${problem}. The entry is ignored.`);
    return [];
  });
}

// Build the merged policy from the settings documents. `allowed` is undefined when
// no allowlist is set. `failClosed` is true when a managed policy is malformed, or
// names a variable that is not set. Then the lock and the lists are not what the
// organization wrote, so every server must stay off.
export function buildPolicy(docs, vars) {
  const warns = [];
  const managedWarns = [];
  const sources = SCOPES.map(([key, label]) => ({ label, settings: docValue(docs[key]) }));
  const managed = sources[0].settings;
  const onlyValue = managed.allowManagedMcpServersOnly;
  if (onlyValue !== undefined && typeof onlyValue !== 'boolean') {
    managedWarns.push('managed settings: allowManagedMcpServersOnly must be true or false.');
  }
  const allowSources = onlyValue === true ? sources.slice(0, 1) : sources;
  const sinkFor = (source) => (source === sources[0] ? managedWarns : warns);
  const allowLists = allowSources
    .filter((s) => s.settings.allowedMcpServers !== undefined)
    .map((s) => validEntries(s.settings.allowedMcpServers, `${s.label} allowedMcpServers`, sinkFor(s), vars));
  const denied = sources.flatMap((s) => validEntries(s.settings.deniedMcpServers, `${s.label} deniedMcpServers`, sinkFor(s), vars));
  return {
    allowed: allowLists.length > 0 ? allowLists.flat() : undefined,
    denied,
    warns: [...warns, ...managedWarns],
    failClosed: managedWarns.length > 0,
  };
}

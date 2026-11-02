// allowedMcpServers and deniedMcpServers, as Claude Code applies them. The
// denylist merges from every settings scope and always wins. The allowlist
// merges too, unless managed settings set allowManagedMcpServersOnly. A list
// that is present but not a list counts as an empty list, so the allowlist fails
// closed. A malformed entry is ignored with a warning, so the rest still applies.

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
    host: hasPort ? authority.slice(0, colon) : authority,
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
  const host = parsed.host.toLowerCase().replace(/\.$/, '');
  const hostname = actual.hostname.toLowerCase().replace(/\.$/, '');
  if (!globToRegExp(host).test(hostname)) return false;
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
    return typeof entry.serverUrl === 'string' && parseUrlPattern(entry.serverUrl) !== undefined
      ? undefined : 'serverUrl is not a URL pattern';
  }
  const command = entry.serverCommand;
  const ok = Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === 'string');
  return ok ? undefined : 'serverCommand must be a non-empty list of strings';
}

// Keep the well-formed entries of one list. Warn on each malformed one.
function validEntries(list, where, warns) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    warns.push(`${where} must be a list. It is treated as an empty list.`);
    return [];
  }
  return list.flatMap((entry, index) => {
    const problem = entryProblem(entry);
    if (problem === undefined) return [entry];
    warns.push(`${where}[${index}]: ${problem}. The entry is ignored.`);
    return [];
  });
}

// Expand ${VAR} in a policy entry. Policy entries expand from the process
// environment. Claude Code pins that environment, so a settings file cannot change
// what an entry means.
function expandEntry(entry, vars) {
  const none = () => {};
  if ('serverUrl' in entry) return { serverUrl: expandVars(entry.serverUrl, vars, none) };
  if ('serverCommand' in entry) {
    return { serverCommand: entry.serverCommand.map((part) => expandVars(part, vars, none)) };
  }
  return entry;
}

// Build the merged policy from the settings documents. The result holds the
// lists to apply (`allowed` is undefined when no allowlist is set) and the warnings.
export function buildPolicy(docs, vars) {
  const warns = [];
  const sources = SCOPES.map(([key, label]) => ({ label, settings: docValue(docs[key]) }));
  const managed = sources[0].settings;
  const onlyValue = managed.allowManagedMcpServersOnly;
  if (onlyValue !== undefined && typeof onlyValue !== 'boolean') {
    warns.push('managed settings: allowManagedMcpServersOnly must be true or false. It is treated as false.');
  }
  const allowSources = onlyValue === true ? sources.slice(0, 1) : sources;
  const allowLists = allowSources
    .filter((s) => s.settings.allowedMcpServers !== undefined)
    .map((s) => validEntries(s.settings.allowedMcpServers, `${s.label} allowedMcpServers`, warns));
  const denied = sources.flatMap((s) => validEntries(s.settings.deniedMcpServers, `${s.label} deniedMcpServers`, warns));
  return {
    allowed: allowLists.length > 0 ? allowLists.flat().map((e) => expandEntry(e, vars)) : undefined,
    denied: denied.map((e) => expandEntry(e, vars)),
    warns,
  };
}

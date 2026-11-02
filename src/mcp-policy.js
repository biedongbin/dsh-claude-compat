// allowedMcpServers and deniedMcpServers, as Claude Code applies them. The
// denylist merges from every settings scope and always wins. The allowlist
// merges too, unless managed settings set allowManagedMcpServersOnly.

import { expandVars } from './mcp-vars.js';

const DEFAULT_PORT = { http: '80', https: '443' };

// Settings documents are { value } when read, { error } when unreadable.
function settingsOf(doc) {
  return doc?.value ?? {};
}

// Policy entries expand from the process environment. Claude Code pins that
// environment, so a settings file cannot change what an entry means.
function expandEntry(entry, vars) {
  const none = () => {};
  if (typeof entry.serverUrl === 'string') {
    return { serverUrl: expandVars(entry.serverUrl, vars, none) };
  }
  if (Array.isArray(entry.serverCommand)) {
    return { serverCommand: entry.serverCommand.map((part) => expandVars(String(part), vars, none)) };
  }
  return entry;
}

// Build the merged policy from the settings documents. The lists keep only
// well-formed entries, and a missing list means "no restriction".
export function buildPolicy(docs, vars = process.env) {
  const managed = settingsOf(docs.managedSettings);
  const scopes = [managed, settingsOf(docs.userSettings), settingsOf(docs.projectSettings), settingsOf(docs.localSettings)];
  const allowScopes = managed.allowManagedMcpServersOnly === true ? [managed] : scopes;
  const allowLists = allowScopes.map((s) => s.allowedMcpServers).filter(Array.isArray);
  const denyLists = scopes.map((s) => s.deniedMcpServers).filter(Array.isArray);
  const allowed = allowLists.length > 0 ? allowLists.flat().map((e) => expandEntry(e, vars)) : undefined;
  return { allowed, denied: denyLists.flat().map((e) => expandEntry(e, vars)) };
}

// Escape a glob where `*` is the only wildcard.
function globToRegExp(glob, flags = '') {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, flags);
}

// Split `scheme://host[:port][/path]` into its parts. Returns undefined when the
// shape does not match.
function parseUrlPattern(pattern) {
  const shape = /^([^:/]+):\/\/([^/]*)(\/.*)?$/.exec(pattern);
  if (shape === null) return undefined;
  const [, scheme, authority, path] = shape;
  const colon = authority.lastIndexOf(':');
  const portPart = colon === -1 ? undefined : authority.slice(colon + 1);
  const hasPort = portPart !== undefined && /^([0-9]+|\*)$/.test(portPart);
  return {
    scheme,
    host: hasPort ? authority.slice(0, colon) : authority,
    port: hasPort ? portPart : undefined,
    path,
  };
}

// The port rules follow the managed-MCP docs. A host written out in full
// allows only the scheme's default port. A `*` in the host, or a `*` port,
// allows any port. A pattern with no path allows any path.
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
  const effectivePort = actual.port !== '' ? actual.port : (DEFAULT_PORT[scheme] ?? '');
  if (!portAllowed(parsed, effectivePort, scheme)) return false;
  return parsed.path === undefined || parsed.path === '' || globToRegExp(parsed.path).test(actual.pathname);
}

function portAllowed(parsed, effectivePort, scheme) {
  if (parsed.port === '*') return true;
  if (parsed.port !== undefined) return parsed.port === effectivePort;
  if (parsed.host.includes('*')) return true;
  return effectivePort === DEFAULT_PORT[scheme];
}

// One policy entry against one server. `server` carries `label` (the name the
// user gave it), and either `url` or `command` with `args`.
function entryMatches(entry, server) {
  if ('serverName' in entry) return entry.serverName === server.label;
  if ('serverUrl' in entry) return server.url !== undefined && urlMatches(entry.serverUrl, server.url);
  if ('serverCommand' in entry) {
    const actual = [server.command, ...(server.args ?? [])];
    return server.command !== undefined && entry.serverCommand.length === actual.length
      && entry.serverCommand.every((part, i) => part === actual[i]);
  }
  return false;
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

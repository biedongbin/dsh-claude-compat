// dsh-claude-compat: MCP servers from <projectRoot>/.mcp.json (Claude Code
// format). Read once at DSH startup from the launch workspace; each server is
// mounted as an @deepseek-ai/dsh-mcp-client plugin instance (stdio for
// `command` entries, streamable-http for `url`/`type:'http'|'sse'` entries).
//
// Failure handling is deliberately non-fatal: an unreadable/malformed .mcp.json
// or an absent dsh-mcp-client package logs a warning and skips, never crashing
// the harness. failOnStartupError only forwards to the mcp-client plugin.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findProjectRootSync,
  pathExists,
} from './lib.js';

// Pure translation of Claude Code's .mcp.json body into dsh-mcp-client plugin
// configs, keyed by server name. Malformed entries are skipped and reported.
export function translateMcpServers(rawJson, { failOnStartupError = false } = {}) {
  let parsed;
  try { parsed = JSON.parse(rawJson); }
  catch {
    return { servers: [], warns: [`invalid-json: ${String(rawJson).slice(0, 100)}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { servers: [], warns: ['invalid-json: root must be an object'] };
  }
  const servers = parsed.mcpServers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    return { servers: [], warns: ['mcpServers: missing or not an object'] };
  }
  const out = [];
  const warns = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      warns.push(`${name}: malformed entry, skipped`);
      continue;
    }
    // serverName must match /^[A-Za-z0-9_-]{1,32}$/ (dsh-mcp-client contract).
    const serverName = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
    if (serverName.length === 0) {
      warns.push(`${name}: empty server name, skipped`);
      continue;
    }
    const base = {
      serverName,
      toolCallTimeoutMs: 60_000,
      failOnStartupError,
    };
    if (typeof entry.command === 'string' && entry.command.length > 0) {
      out.push({
        ...base,
        transport: 'stdio',
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === 'string') : [],
        env: stringDict(entry.env),
        cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
      });
    } else if (typeof entry.url === 'string' && entry.url.length > 0) {
      out.push({
        ...base,
        transport: 'streamable-http',
        url: entry.url,
        headers: stringDict(entry.headers),
      });
    } else if (entry.type === 'http' || entry.type === 'sse') {
      warns.push(`${name}: type '${entry.type}' without a url, skipped`);
    } else {
      warns.push(`${name}: neither command nor url, skipped`);
    }
  }
  return { servers: out, warns };
}

function stringDict(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
}

// Mount one mcp-client per server listed in <projectRoot>/.mcp.json. Lifecycle:
// process-lifetime by design — the file is read once at DSH startup from the
// launch workspace via process.cwd()-based root discovery; deviating from the
// per-session cwd rules (which are session-scoped) is intended and documented.
export async function mountMcpServers(ctx, config) {
  const projectRoot = findProjectRootSync(process.cwd(), config.projectRootMarkers);
  if (projectRoot === undefined) return;
  const mcpPath = join(projectRoot, '.mcp.json');
  if (!(await pathExists(mcpPath))) return;
  let raw;
  try { raw = readFileSync(mcpPath, 'utf8'); } catch (error) {
    console.warn(`dsh-claude-compat: .mcp.json unreadable: ${error?.message ?? error}`, '(skipping MCP)');
    return;
  }
  const { servers, warns } = translateMcpServers(raw, {
    failOnStartupError: config.mcpFailOnStartupError ?? false,
  });
  warns.forEach((w) => console.warn(`dsh-claude-compat: .mcp.json: ${w}`));
  await mountMcpConfigs(ctx, servers);
}

// Mount pre-translated server configs (shared by .mcp.json and plugin MCP).
export async function mountMcpConfigs(ctx, servers) {
  if (servers.length === 0) return;
  let mcpClientModule;
  try {
    mcpClientModule = await import('@deepseek-ai/dsh-mcp-client');
  } catch (error) {
    console.warn('dsh-claude-compat: @deepseek-ai/dsh-mcp-client not installed', '(MCP disabled)', error?.message ?? error);
    return;
  }
  const mcpClient = mcpClientModule.default ?? mcpClientModule;
  const mounted = new Set();
  for (const server of servers) {
    if (mounted.has(server.serverName)) {
      console.warn(`dsh-claude-compat: duplicate serverName "${server.serverName}" skipped`);
      continue;
    }
    mounted.add(server.serverName);
    ctx.plugin(mcpClient, server).catch((error) => {
      console.warn(`dsh-claude-compat: server "${server.serverName}" failed to mount: ${error?.message ?? error}`);
    });
  }
}
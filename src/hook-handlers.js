// dsh-claude-compat: runners for the Claude Code hook handler types. Each runner
// resolves with { exitCode, stdout, failed, reason } and never rejects, so a
// broken hook is a failed run and never an error inside a DSH listener.

import { spawn } from 'node:child_process';

// A hook's output goes back to the model, so each stream keeps at most this many characters.
const OUTPUT_LIMIT = 1_048_576;

function appendCapped(text, chunk) {
  return (text + chunk).slice(0, OUTPUT_LIMIT);
}

// ----- command ----------------------------------------------------------------

function hookEnv(hook) {
  return { ...process.env, CLAUDE_PROJECT_DIR: hook.projectDir };
}

// Stop the hook and whatever it started. Shell form runs a child of /bin/sh,
// so the whole process group is signalled. If the group is already gone, only
// the direct child can be killed.
function killHook(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

// Why a run ended without a usable decision. Exit 0 and exit 2 are decisions.
function closeReason(code, signal) {
  if (code === 0 || code === 2) return undefined;
  return code === null ? `killed by ${signal}` : `exit ${code}`;
}

/**
 * Run one command hook. `failed` is true for a timeout, a start error, a
 * signal, or an exit code other than 0 or 2. `reason` says why and is set only
 * when `failed` is true.
 * @param {object} hook handler from loadHookSettings
 * @param {string} stdin JSON payload
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, failed: boolean, reason?: string}>}
 */
export function runHookCommand(hook, stdin, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;
    const finish = (exitCode, failed, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A stream that reached the limit may have been cut, so a decision in it may be lost.
      const truncated = stdout.length >= OUTPUT_LIMIT || stderr.length >= OUTPUT_LIMIT;
      resolve({ exitCode, stdout, stderr, failed, reason, ...truncated ? { truncated } : {} });
    };
    const [file, argv] = hook.args === undefined
      ? [hook.shell === 'bash' ? '/bin/bash' : '/bin/sh', ['-c', hook.command]]
      : [hook.command, hook.args];
    let child;
    try {
      child = spawn(file, argv, { detached: true, env: hookEnv(hook) });
    } catch (error) {
      // Thrown, not emitted, for an argument Node refuses (for example a NUL byte).
      finish(1, true, `cannot start: ${error.message}`);
      return;
    }
    timer = setTimeout(() => {
      killHook(child);
      finish(1, true, `timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    // One decoder per stream: a character split across two data events stays whole.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = appendCapped(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = appendCapped(stderr, chunk); });
    child.on('error', (error) => finish(1, true, `failed to start: ${error.code ?? error.message}`));
    child.on('close', (code, signal) => finish(code ?? 1, code !== 0 && code !== 2, closeReason(code, signal)));
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') console.warn(`dsh-claude-compat: hook stdin error: ${error.message}`);
    });
    child.stdin.end(stdin);
  });
}

// ----- http -------------------------------------------------------------------

// `$VAR` and `${VAR}` in a header value. A variable that `allowedEnvVars` does
// not list becomes an empty string, as in Claude Code. The list comes from the same hook
// entry, so it limits a typo or a copied header, not a settings file that is hostile: such a
// file can already run a command hook that reads the environment.
function interpolateHeader(value, allowed, env) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, bare) => {
    const name = braced ?? bare;
    return allowed.includes(name) ? (env[name] ?? '') : '';
  });
}

function httpHeaders(hook, env) {
  const allowed = hook.allowedEnvVars ?? [];
  const headers = { 'content-type': 'application/json' };
  for (const [name, value] of Object.entries(hook.headers ?? {})) {
    headers[name] = interpolateHeader(value, allowed, env);
  }
  return headers;
}

/** A run that failed with a reason, for a runner that cannot reach a decision. */
export function failedRun(reason) {
  return { exitCode: 1, stdout: '', stderr: '', failed: true, reason };
}

function httpFailureReason(error, timeoutMs) {
  if (error instanceof RangeError) return error.message;
  if (error?.name === 'TimeoutError') return `timed out after ${timeoutMs}ms`;
  return `http request failed: ${error?.cause?.code ?? error?.message ?? String(error)}`;
}

// 2xx with an empty body is a success. 2xx with a JSON object is read like
// command output. Any other body, and any non-2xx status, is a failed run.
function interpretHttpResponse(status, body) {
  if (status < 200 || status >= 300) return failedRun(`http ${status}`);
  const text = body.trim();
  if (text === '') return { exitCode: 0, stdout: '', stderr: '', failed: false };
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failedRun('http response body is not a JSON object');
  }
  return { exitCode: 0, stdout: text, failed: false };
}

// The body of a response, at most OUTPUT_LIMIT bytes. A longer body is an error, so a server
// cannot fill memory or flood the model. The body is read as a stream and cancelled at the
// limit, and a declared Content-Length over the limit is refused before any read.
async function readBody(response) {
  const tooLarge = () => new RangeError('response body is too large');
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > OUTPUT_LIMIT) throw tooLarge();
  const reader = response.body?.getReader?.();
  if (reader === undefined) {
    const text = await response.text();
    if (text.length > OUTPUT_LIMIT) throw tooLarge();
    return text;
  }
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > OUTPUT_LIMIT) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * POST the hook payload as JSON to the handler's URL.
 * @param {object} hook handler with url, headers, allowedEnvVars
 * @param {string} payload JSON text
 * @param {{timeoutMs?: number, env?: object, fetchImpl?: Function}} [options]
 * @returns {Promise<{exitCode: number, stdout: string, failed: boolean, reason?: string}>}
 */
export async function runHttpHook(hook, payload, { timeoutMs = 60_000, env = process.env, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(hook.url, {
      method: 'POST',
      headers: httpHeaders(hook, env),
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return interpretHttpResponse(response.status, await readBody(response));
  } catch (error) {
    return failedRun(httpFailureReason(error, timeoutMs));
  }
}

// ----- dispatch ---------------------------------------------------------------

/**
 * Run one hook with the runner for its type.
 * @param {object} hook handler from loadHookSettings
 * @param {string} payload JSON text of the hook input
 * @param {{timeoutMs?: number, runners?: object, event?: string, agent?: object}} [options] `runners` overrides
 *   a type, for tests and for the types that need DSH. `event` and `agent` tell a model-backed runner what asked.
 * @returns {Promise<{exitCode: number, stdout: string, failed: boolean, reason?: string}>}
 */
export function runHandler(hook, payload, { timeoutMs, runners = {}, event, agent } = {}) {
  const runner = runners[hook.type] ?? DEFAULT_RUNNERS[hook.type];
  if (runner === undefined) {
    return Promise.resolve(failedRun(`handler type "${hook.type}" is not available in this session`));
  }
  return runner(hook, payload, { timeoutMs, event, agent });
}

const DEFAULT_RUNNERS = {
  command: runHookCommand,
  http: runHttpHook,
};

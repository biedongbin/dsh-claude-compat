// dsh-claude-compat: runners for the Claude Code hook handler types. Each runner
// resolves with { exitCode, stdout, failed, reason } and never rejects, so a
// broken hook is a failed run and never an error inside a DSH listener.

import { spawn } from 'node:child_process';

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
 * @returns {Promise<{exitCode: number, stdout: string, failed: boolean, reason?: string}>}
 */
export function runHookCommand(hook, stdin, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let timer;
    const finish = (exitCode, failed, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, failed, reason });
    };
    const [file, argv] = hook.args === undefined
      ? ['/bin/sh', ['-c', hook.command]]
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
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stdout += chunk; }); // stderr joins the feedback
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
// not list becomes an empty string, as in Claude Code, so a project's settings
// cannot read an arbitrary variable into a request.
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

function failedRun(reason) {
  return { exitCode: 1, stdout: '', failed: true, reason };
}

function httpFailureReason(error, timeoutMs) {
  if (error?.name === 'TimeoutError') return `timed out after ${timeoutMs}ms`;
  return `http request failed: ${error?.cause?.code ?? error?.message ?? String(error)}`;
}

// 2xx with an empty body is a success. 2xx with a JSON object is read like
// command output. Any other body, and any non-2xx status, is a failed run.
function interpretHttpResponse(status, body) {
  if (status < 200 || status >= 300) return failedRun(`http ${status}`);
  const text = body.trim();
  if (text === '') return { exitCode: 0, stdout: '', failed: false };
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failedRun('http response body is not a JSON object');
  }
  return { exitCode: 0, stdout: text, failed: false };
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    return interpretHttpResponse(response.status, await response.text());
  } catch (error) {
    return failedRun(httpFailureReason(error, timeoutMs));
  }
}

// ----- dispatch ---------------------------------------------------------------

/**
 * Run one hook with the runner for its type.
 * @param {object} hook handler from loadHookSettings
 * @param {string} payload JSON text of the hook input
 * @param {{timeoutMs?: number, runners?: object}} [options] `runners` overrides a type, for tests and for the types that need DSH
 * @returns {Promise<{exitCode: number, stdout: string, failed: boolean, reason?: string}>}
 */
export function runHandler(hook, payload, { timeoutMs, runners = {} } = {}) {
  const runner = runners[hook.type] ?? DEFAULT_RUNNERS[hook.type];
  if (runner === undefined) {
    return Promise.resolve(failedRun(`handler type "${hook.type}" is not available in this session`));
  }
  return runner(hook, payload, { timeoutMs });
}

const DEFAULT_RUNNERS = {
  command: runHookCommand,
  http: runHttpHook,
};

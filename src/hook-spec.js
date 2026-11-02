// dsh-claude-compat: parsing for Claude Code hook handler entries, and the
// `if` permission-rule filter. Pure functions (no I/O) so the rules can be
// tested without a running DSH.

const TOOL_EVENTS = new Set(['pre-tool-use', 'post-tool-use']);
const ON_FAILURE = new Set(['continue', 'block']);

// Tools whose permission rule matches a path, not a shell command.
const PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// A permission rule is `Tool` or `Tool(pattern)`.
const RULE_SHAPE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/s;

function unsupported(reason) {
  return { ok: false, reason };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkOptionalFields(raw, event) {
  if (raw.args !== undefined && !isStringArray(raw.args)) return 'args must be an array of strings';
  if (raw.if !== undefined && !TOOL_EVENTS.has(event)) return 'if applies only to tool events';
  if (raw.if !== undefined && typeof raw.if !== 'string') return 'if must be a string';
  if (raw.timeout !== undefined && !(Number.isFinite(raw.timeout) && raw.timeout > 0)) {
    return 'timeout must be a positive number of seconds';
  }
  if (raw.onFailure !== undefined && !ON_FAILURE.has(raw.onFailure)) {
    return 'onFailure must be "continue" or "block"';
  }
  return undefined;
}

/**
 * Replace every `${CLAUDE_PROJECT_DIR}` in a hook command or argument.
 * Claude Code expands this variable before it runs a hook.
 * @param {string} text
 * @param {string} projectDir absolute project root
 * @returns {string}
 */
export function expandProjectDir(text, projectDir) {
  return text.replaceAll('${CLAUDE_PROJECT_DIR}', projectDir);
}

/**
 * Parse one hook handler from a settings.json `hooks` entry.
 * Only `command` handlers run. Other handler types are reported, not silently
 * dropped, so a user can see which hook did not run and why.
 * @param {unknown} raw the handler object
 * @param {{event: string, projectDir: string}} context hook event name and project root
 * @returns {{ok: true, handler: object} | {ok: false, reason: string}}
 */
export function parseHookHandler(raw, { event, projectDir }) {
  if (!isPlainObject(raw)) return unsupported('handler is not an object');
  const type = raw.type ?? 'command';
  if (type !== 'command') return unsupported(`handler type "${type}" is not supported`);
  if (typeof raw.command !== 'string' || raw.command === '') return unsupported('command is missing');
  const problem = checkOptionalFields(raw, event);
  if (problem !== undefined) return unsupported(problem);
  return {
    ok: true,
    handler: {
      command: expandProjectDir(raw.command, projectDir),
      args: raw.args?.map((arg) => expandProjectDir(arg, projectDir)),
      ifRule: raw.if,
      timeoutMs: raw.timeout === undefined ? undefined : Math.round(raw.timeout * 1000),
      async: raw.async === true && TOOL_EVENTS.has(event),
      onFailure: raw.onFailure ?? 'continue',
      projectDir,
    },
  };
}

// `*` matches any run of characters. Every other character is literal.
function globToRegExp(pattern) {
  const escaped = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`, 's');
}

// The input field a permission rule pattern is matched against.
function ruleSubject(toolName, toolInput) {
  if (!isPlainObject(toolInput)) return undefined;
  let key;
  if (toolName === 'Bash') key = 'command';
  else if (PATH_TOOLS.has(toolName)) key = 'file_path';
  else return undefined;
  return typeof toolInput[key] === 'string' ? toolInput[key] : undefined;
}

/**
 * Does a hook's `if` rule match this tool call?
 * `Tool` alone matches any call to that tool. `Tool(pattern)` matches the
 * call's command (Bash) or file path (file tools) against a `*` glob.
 * A rule for a tool that has no pattern field never matches when it has a pattern.
 * @param {string} rule for example "Bash(git *)"
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {boolean}
 */
export function matchIfRule(rule, toolName, toolInput) {
  const shape = RULE_SHAPE.exec(rule.trim());
  if (shape === null || shape[1] !== toolName) return false;
  if (shape[2] === undefined) return true;
  const subject = ruleSubject(toolName, toolInput);
  return subject !== undefined && globToRegExp(shape[2]).test(subject);
}

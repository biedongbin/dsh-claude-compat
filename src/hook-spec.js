// dsh-claude-compat: parsing for Claude Code hook handler entries, and the
// `if` permission-rule filter. Pure functions (no I/O) so the rules can be
// tested without a running DSH.

const TOOL_EVENTS = new Set(['pre-tool-use', 'post-tool-use']);
const ON_FAILURE = new Set(['continue', 'block']);

// Node clamps a setTimeout delay above this to 1 ms, so a larger timeout would
// kill the hook at once.
const MAX_TIMER_MS = 2147483647;

// The input field a rule pattern is matched against, per tool. Field names are
// from the Claude Code tools reference. Other tools take only a bare tool name.
const RULE_FIELD = new Map([
  ['Bash', 'command'],
  ['Read', 'file_path'],
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
]);

// A permission rule is `Tool` or `Tool(pattern)`.
const RULE_SHAPE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/s;

// Separators Claude Code recognizes between the subcommands of a Bash command.
// The split is textual, so a separator inside quotes also splits. A hook then
// runs more often, never less.
const SUBCOMMAND_SEPARATOR = /&&|\|\|?&?|;|&|\n/;

const PROJECT_DIR_TOKEN = '${CLAUDE_PROJECT_DIR}';

function unsupported(reason) {
  return { ok: false, reason };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function commandProblem(raw) {
  return typeof raw.command === 'string' && raw.command !== '' ? undefined : 'command is missing';
}

function argsProblem(raw) {
  if (raw.args === undefined) return undefined;
  const valid = Array.isArray(raw.args) && raw.args.every((item) => typeof item === 'string');
  return valid ? undefined : 'args must be an array of strings';
}

function timeoutProblem(raw) {
  if (raw.timeout === undefined) return undefined;
  const ms = Math.round(raw.timeout * 1000);
  const valid = typeof raw.timeout === 'number' && Number.isInteger(ms) && ms >= 1 && ms <= MAX_TIMER_MS;
  return valid ? undefined : 'timeout must be between 0.001 and 2147483.647 seconds';
}

function onFailureProblem(raw) {
  if (raw.onFailure === undefined || ON_FAILURE.has(raw.onFailure)) return undefined;
  return 'onFailure must be "continue" or "block"';
}

function asyncProblem(raw) {
  if (raw.async === undefined || typeof raw.async === 'boolean') return undefined;
  return 'async must be true or false';
}

// A permission rule for `if`: a bare tool name, or Tool(pattern) for a tool
// whose input field is known. Any other shape would never match, so it is
// rejected here rather than skipped at run time.
function ruleProblem(rule) {
  const shape = RULE_SHAPE.exec(rule.trim());
  if (shape === null) return `if rule "${rule}" is not a tool name or Tool(pattern)`;
  if (shape[2] !== undefined && !RULE_FIELD.has(shape[1])) {
    return `if rule patterns are not supported for ${shape[1]}`;
  }
  return undefined;
}

function ifProblem(raw, event) {
  if (raw.if === undefined) return undefined;
  if (typeof raw.if !== 'string') return 'if must be a string';
  if (!TOOL_EVENTS.has(event)) return 'if applies only to tool events';
  return ruleProblem(raw.if);
}

function fieldProblem(raw, event) {
  const checks = [
    commandProblem(raw),
    argsProblem(raw),
    timeoutProblem(raw),
    onFailureProblem(raw),
    asyncProblem(raw),
    ifProblem(raw, event),
  ];
  return checks.find((problem) => problem !== undefined);
}

// Notes name a field that is accepted but has no effect for this event.
function notesFor(raw, event) {
  const notes = [];
  const asyncTool = raw.async === true && TOOL_EVENTS.has(event);
  if (raw.onFailure !== undefined && !TOOL_EVENTS.has(event)) {
    notes.push('onFailure applies only to tool events; ignored');
  } else if (raw.onFailure !== undefined && asyncTool) {
    notes.push('onFailure is ignored for async hooks');
  }
  if (raw.async === true && event === 'user-prompt-submit') {
    notes.push('async applies to tool events; this hook runs in the foreground');
  }
  return notes;
}

/**
 * Parse one hook handler from a settings.json `hooks` entry.
 * Only `command` handlers run. Other handler types are reported, not dropped,
 * so a user can see which hook did not run and why.
 *
 * A command with `args` runs the program directly, with no shell. Without
 * `args`, the command runs in /bin/sh, which reads `${CLAUDE_PROJECT_DIR}` from
 * the environment. The variable is never spliced into shell text, so a project
 * path with shell characters stays data.
 * @param {unknown} raw the handler object
 * @param {{event: string, projectDir: string}} context hook event name, project root
 * @returns {{ok: true, handler: object, notes: string[]} | {ok: false, reason: string}}
 */
export function parseHookHandler(raw, { event, projectDir }) {
  if (!isPlainObject(raw)) return unsupported('handler is not an object');
  const type = raw.type ?? 'command';
  if (type !== 'command') return unsupported(`handler type "${type}" is not supported`);
  const problem = fieldProblem(raw, event);
  if (problem !== undefined) return unsupported(problem);
  const execForm = raw.args !== undefined;
  const expand = (text) => text.replaceAll(PROJECT_DIR_TOKEN, () => projectDir);
  return {
    ok: true,
    handler: {
      command: execForm ? expand(raw.command) : raw.command,
      args: execForm ? raw.args.map(expand) : undefined,
      ifRule: raw.if,
      timeoutMs: raw.timeout === undefined ? undefined : Math.round(raw.timeout * 1000),
      async: raw.async === true && TOOL_EVENTS.has(event),
      onFailure: raw.onFailure ?? 'continue',
      projectDir,
    },
    notes: notesFor(raw, event),
  };
}

function escapeLiteral(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// `*` matches any run of characters, including spaces and slashes. Every other
// character is literal.
function globBody(text) {
  return text.split('*').map(escapeLiteral).join('.*');
}

// Claude Code allows a trailing ` *` to match the bare command, as in
// `Bash(npm run *)` matching `npm run`. The `:*` suffix is the same rule
// (`Bash(ls:*)` equals `Bash(ls *)`). That optional tail applies only when the
// rest of the pattern has no `*`, which is the form the docs show.
function patternRegExp(pattern) {
  const hasTail = pattern.endsWith(':*') || pattern.endsWith(' *');
  if (!hasTail) return new RegExp(`^${globBody(pattern)}$`, 's');
  const core = pattern.slice(0, -2);
  const tail = core.includes('*') ? ' .*' : '(?: .*)?';
  return new RegExp(`^${globBody(core)}${tail}$`, 's');
}

// The text a rule pattern is tested against. Bash also tests each subcommand,
// so `cd /tmp && git push` matches `Bash(git push *)`.
function subjectsOf(toolName, toolInput) {
  const field = RULE_FIELD.get(toolName);
  const value = field === undefined || !isPlainObject(toolInput) ? undefined : toolInput[field];
  if (typeof value !== 'string') return [];
  if (toolName !== 'Bash') return [value];
  return [value, ...value.split(SUBCOMMAND_SEPARATOR).map((part) => part.trim())];
}

/**
 * Does a hook's `if` rule match this tool call?
 * `Tool` alone matches every call to that tool. `Tool(pattern)` matches the
 * Bash command (or any subcommand) or the file path against a `*` glob.
 * `**` is treated like `*`; the gitignore-style `**` of file rules is not
 * implemented.
 * @param {string} rule for example "Bash(git *)"
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {boolean}
 */
export function matchIfRule(rule, toolName, toolInput) {
  const shape = RULE_SHAPE.exec(rule.trim());
  if (shape === null || shape[1] !== toolName) return false;
  if (shape[2] === undefined) return true;
  const regex = patternRegExp(shape[2]);
  return subjectsOf(toolName, toolInput).some((subject) => regex.test(subject));
}

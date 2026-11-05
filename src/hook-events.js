// dsh-claude-compat: the Claude Code hook events and how each one maps to DSH.
// Event names are from https://code.claude.com/docs/en/hooks. The DSH points
// are from the harness source (packages/extensions/tool-cordis/src/api-catalog.ts).

// The Claude Code event names. The internal name is the same name in kebab case.
const NAMES = [
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion',
  'PreToolUse', 'PermissionRequest', 'PermissionDenied', 'PostToolUse',
  'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded',
  'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged',
  'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact',
  'PreModelSwitch', 'PostModelSwitch', 'Elicitation', 'ElicitationResult',
  'SessionEnd',
];

const kebab = (name) => name.replace(/[A-Z]/g, (letter, index) => (index === 0 ? '' : '-') + letter.toLowerCase());

// Claude event name -> internal kebab name.
export const CLAUDE_EVENTS = Object.fromEntries(NAMES.map((name) => [name, kebab(name)]));

// Events where Claude Code evaluates a hook's `if` rule. On any other event a
// hook with `if` never runs.
export const IF_EVENTS = new Set([
  'pre-tool-use',
  'post-tool-use',
  'post-tool-use-failure',
  'permission-request',
  'permission-denied',
]);

// Handler types per event (Claude Code docs, "Prompt-based hooks"). Every event takes
// command, http and mcp_tool, except SessionStart and Setup, which take no http hook.
// The model-backed types prompt and agent run on these events only.
const MODEL_EVENTS = new Set([
  'permission-denied',
  'post-tool-batch',
  'post-tool-use',
  'post-tool-use-failure',
  'pre-tool-use',
  'stop',
  'subagent-stop',
  'task-completed',
  'task-created',
  'teammate-idle',
  'user-prompt-expansion',
  'user-prompt-submit',
]);

/**
 * The handler types that Claude Code accepts on an event.
 * @param {string} event internal event name
 * @returns {Set<string>}
 */
export function handlerTypesFor(event) {
  if (event === 'session-start' || event === 'setup') return new Set(['command', 'mcp_tool']);
  if (event === 'permission-request') return new Set(['command', 'http', 'mcp_tool', 'prompt']);
  if (MODEL_EVENTS.has(event)) return new Set(['command', 'http', 'mcp_tool', 'prompt', 'agent']);
  return new Set(['command', 'http', 'mcp_tool']);
}

// `onFailure` has no effect on these events (Claude Code docs, "Failure behavior").
export const NO_ONFAILURE_EVENTS = new Set(['stop', 'subagent-stop', 'task-completed', 'teammate-idle']);

// Events with no DSH extension point at all. Each reason names the evidence in
// the harness source, so a user sees why the hook cannot run here.
export const UNSUPPORTED_EVENTS = new Map([
  ['setup', 'DSH has no --init-only or --maintenance start mode'],
  ['directory-added', 'DSH can add a directory only with the --add-dir start flag, not in a running session'],
  ['worktree-create', 'DSH creates worktrees through a service method with no event or hook point to replace'],
  ['worktree-remove', 'DSH has no worktree removal event or hook point'],
  ['elicitation', 'the DSH MCP client does not support elicitation requests'],
  ['elicitation-result', 'the DSH MCP client does not support elicitation requests'],
  ['pre-model-switch', 'DSH applies a model change before any plugin sees it, so a hook cannot stop the change'],
]);

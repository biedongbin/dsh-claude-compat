// dsh-claude-compat: the Claude Code hook events and how each one maps to DSH.
// Event names are from https://code.claude.com/docs/en/hooks. The DSH points
// are from the harness source (packages/extensions/tool-cordis/src/api-catalog.ts).

// Claude event name -> internal kebab name.
export const CLAUDE_EVENTS = {
  SessionStart: 'session-start',
  Setup: 'setup',
  UserPromptSubmit: 'user-prompt-submit',
  UserPromptExpansion: 'user-prompt-expansion',
  PreToolUse: 'pre-tool-use',
  PermissionRequest: 'permission-request',
  PermissionDenied: 'permission-denied',
  PostToolUse: 'post-tool-use',
  PostToolUseFailure: 'post-tool-use-failure',
  PostToolBatch: 'post-tool-batch',
  Notification: 'notification',
  MessageDisplay: 'message-display',
  SubagentStart: 'subagent-start',
  SubagentStop: 'subagent-stop',
  TaskCreated: 'task-created',
  TaskCompleted: 'task-completed',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  TeammateIdle: 'teammate-idle',
  InstructionsLoaded: 'instructions-loaded',
  ConfigChange: 'config-change',
  CwdChanged: 'cwd-changed',
  DirectoryAdded: 'directory-added',
  FileChanged: 'file-changed',
  WorktreeCreate: 'worktree-create',
  WorktreeRemove: 'worktree-remove',
  PreCompact: 'pre-compact',
  PostCompact: 'post-compact',
  PreModelSwitch: 'pre-model-switch',
  PostModelSwitch: 'post-model-switch',
  Elicitation: 'elicitation',
  ElicitationResult: 'elicitation-result',
  SessionEnd: 'session-end',
};

// Events where Claude Code evaluates a hook's `if` rule. On any other event a
// hook with `if` never runs.
export const IF_EVENTS = new Set([
  'pre-tool-use',
  'post-tool-use',
  'post-tool-use-failure',
  'permission-request',
  'permission-denied',
]);

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

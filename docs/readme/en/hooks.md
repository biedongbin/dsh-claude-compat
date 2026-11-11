[← Project overview](../../../README.md) · [简体中文](../zh-cn/hooks.md)

# Hooks

The plugin reads hooks from `~/.claude/settings.json`, `<project>/.claude/settings.json` and `<project>/.claude/settings.local.json`.
Each hook runs with the Claude Code JSON input on stdin, and its exit code and JSON output follow the Claude Code rules for the event.
Handler types are `command`, `http`, `mcp_tool`, `prompt` and `agent`, on the events that Claude Code allows them on.
A hook that fails (timeout, start error, other exit code) is logged with its reason and lets the action go on, unless `onFailure` is `"block"`.
A matcher of letters, digits, `_`, `-`, space, `,` and `|` is an exact list of names. Any other matcher is an unanchored regular expression.
A `*` that is not part of `.*`, as in `mcp__*__delete`, also works as the wildcard of earlier versions.
An event with no subject, such as Stop or UserPromptSubmit, ignores the matcher, as in Claude Code.
A hook's `if` rule is a filter that decides whether the hook runs, as in Claude Code. A Bash rule matches when any subcommand matches, so `if` does not prove that the whole command is safe: a hook that approves a request must check the command itself.
`session_id` is the DSH session id. Inside a subagent it stays the main session id, and `agent_id` and `agent_type` name the subagent.
`transcript_path` is empty, because DSH has no transcript file.

| Claude Code event | DSH extension point | Notes |
|---|---|---|
| SessionStart / SessionEnd | `agent/created` / `agent/disposed` | Main sessions only. SessionEnd default timeout is 1.5 s. |
| UserPromptSubmit | `agent/pre-step` | A block rejects the prompt. Context that this plugin injected is not a prompt. |
| PreToolUse | `tools/pre-execute` | `deny`, `ask` and a block map to DSH decisions. `updatedInput` makes DSH ask the user, with a warning, because DSH cannot change the input. A hook `allow` does not skip the approval of DSH, and it is logged once. |
| PermissionRequest / PermissionDenied | `approval/request` | `allow` and `deny` answer the request. When several hooks answer, a `deny` wins over an `allow`, so a failed `onFailure: "block"` hook always denies. PermissionDenied runs when DSH rejects an approval. |
| PostToolUse / PostToolUseFailure | `tools/post-execute` | `updatedToolOutput`, block feedback and context are applied. |
| PostToolBatch | first `agent/pre-step` after the results | A block rejects the step. |
| TaskCreated / TaskCompleted | `todo_write` | A new or completed todo is a task. A block denies the whole call. |
| Stop | `agent/turn-stopping` | A block or `additionalContext` steers the agent to continue. Stops after 8 continuations in a row (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). |
| StopFailure | `agent/error` | Model-request errors only. |
| SubagentStart / SubagentStop | `subagent/start` / `subagent/end` | Agent type is always `general-purpose`. SubagentStop cannot keep the subagent running. |
| Notification | `approval/request`, `user-questions/request`, `agent/status` | Types `permission_prompt`, `agent_needs_input`, `idle_prompt`. |
| MessageDisplay | `agent/assistant-stream` | Observe only. `displayContent` is ignored with a warning. |
| UserPromptExpansion | `command/run` on `session/event` | Observe only. Runs for every command, not only skills. |
| CwdChanged, PreCompact, PostCompact | `session/event` | Observe only. A PreCompact hook cannot stop the compaction. |
| PostModelSwitch | provider and model of the call configuration on `agent/request` | Context joins the next step. `source` is always `command`. A provider change with the same model name also counts. |
| TeammateIdle | `agent/status` and `team/member` | A block steers the teammate to keep working. |
| InstructionsLoaded | the plugin's own rules loader | `.claude/rules` files only, with `load_reason` `session_start`. |
| FileChanged | polling of the files that the matcher names | `watchPaths` from SessionStart, CwdChanged and FileChanged are watched too. |
| ConfigChange | polling of the settings files, and `skills/change` | Observe only. Hooks load at startup and are never reloaded, so the plugin logs that a changed settings file needs a restart. |

### Gaps: what cannot run in DSH

These seven events cannot run, because DSH has no extension point for them. The plugin warns, with the reason, when a settings file uses one.

| Event | Why it cannot run |
|---|---|
| `Setup` | DSH has no init or maintenance start flags. |
| `DirectoryAdded` | DSH reads `--add-dir` only at start, and emits no event. |
| `WorktreeCreate`, `WorktreeRemove` | The worktree work is a service method. No hook point wraps it, so a hook cannot replace it. |
| `Elicitation`, `ElicitationResult` | The DSH MCP client does not support elicitation. |
| `PreModelSwitch` | DSH applies a model change before a plugin sees it, so a hook cannot block it. `PostModelSwitch` runs. |

These events run, but with less power than in Claude Code:

| Behavior | Difference |
|---|---|
| `PreCompact`, `PostCompact`, `CwdChanged`, `MessageDisplay`, `UserPromptExpansion`, `ConfigChange` | Observe only. DSH reports them after the fact, so a hook cannot block or change them. |
| `PreToolUse` and `PermissionRequest` `updatedInput` | DSH cannot rewrite a tool call. PreToolUse asks the user, and a PermissionRequest `allow` with `updatedInput` is ignored, so the normal answerers decide. Both log a warning. |
| `MessageDisplay` `displayContent` | Ignored with a warning. DSH cannot change displayed text. |
| `SubagentStop` | A block cannot keep the subagent running. |
| `SubagentStart` and `SubagentStop` `agent_type` | Always `general-purpose`. DSH has no named subagent types. |
| `StopFailure` | Model-request errors only. |
| `Notification` | `permission_prompt`, `agent_needs_input` and `idle_prompt` only. |
| `PostModelSwitch` `source` | Always `command`. |
| `InstructionsLoaded` | `.claude/rules` files only, with `load_reason` `session_start`. The plugin does not load other instruction files, so it cannot report them. |
| `transcript_path` | Always empty, because DSH has no transcript file. |
| Settings reload | Hooks load at startup. A changed settings file is logged and needs a restart. |
| `agent` handler | DSH cannot limit the subagent to read-only tools. Inside it no `agent` hook runs, so it cannot start itself again. The other hooks run there, so a deny guard also covers its tool calls. |

Handler details:

- `mcp_tool` calls `mcp__<server>__<tool>` through the DSH tool service. `${path}` in a string of `input` is replaced from the hook input. A server that is still connecting is a failed hook.
- `prompt` asks the session model one question, with no tools. `model` is `provider/model`, or a model of the session provider. `continueOnBlock` and `impossible` follow the Claude Code rules.
- `agent` starts a DSH subagent through the `spawn` provider and reads its structured answer. DSH cannot limit its tools to read-only, so the prompt tells it to change no file, and DSH's normal approvals still guard any write. No `agent` hook runs inside that subagent, and every other hook does, so a PreToolUse deny guard also covers its tool calls.

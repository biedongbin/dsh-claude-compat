[← 项目首页](../../../README.zh-CN.md) · [English](../en/hooks.md)

# Hooks

插件读取 `~/.claude/settings.json`、`<项目>/.claude/settings.json` 与 `<项目>/.claude/settings.local.json` 中的 hooks。
每个 hook 的 stdin 都是 Claude Code 格式的 JSON 输入，退出码与 JSON 输出遵循 Claude Code 对该事件的规则。
处理器类型有 `command`、`http`、`mcp_tool`、`prompt` 和 `agent`，各事件允许的类型与 Claude Code 一致。
hook 失败（超时、无法启动、其他退出码）会记录原因并放行，除非 `onFailure` 为 `"block"`。
matcher 只含字母、数字、`_`、`-`、空格、`,` 和 `|` 时是精确名列表，否则按不锚定的正则表达式处理。
不属于 `.*` 的 `*`（如 `mcp__*__delete`）也像早期版本一样当作通配符。
没有 subject 的事件（如 Stop、UserPromptSubmit）和 Claude Code 一样忽略 matcher。
hook 的 `if` 规则是决定 hook 是否运行的过滤条件，与 Claude Code 一致。Bash 规则在任一子命令匹配时即匹配，因此 `if` 并不能证明整条命令安全：批准请求的 hook 必须自行检查命令。
`session_id` 是 DSH 会话 id；在子 agent 内仍是主会话 id，并用 `agent_id` 与 `agent_type` 标识子 agent。
`transcript_path` 为空，因为 DSH 没有 transcript 文件。

| Claude Code 事件 | DSH 扩展点 | 说明 |
|---|---|---|
| SessionStart / SessionEnd | `agent/created` / `agent/disposed` | 仅主会话。SessionEnd 默认超时 1.5 秒。 |
| UserPromptSubmit | `agent/pre-step` | 拦截会拒绝该提示。本插件自己注入的上下文不算提示。 |
| PreToolUse | `tools/pre-execute` | `deny`、`ask` 与拦截映射为 DSH 决策。`updatedInput` 会让 DSH 询问用户并给出警告，因为 DSH 无法改写输入。hook 的 `allow` 不会跳过 DSH 的审批，且只记录一次日志。 |
| PermissionRequest / PermissionDenied | `approval/request` | `allow` 与 `deny` 直接回答请求。多个 hook 同时回答时，`deny` 优先于 `allow`，因此失败的 `onFailure: "block"` hook 一定会拒绝。DSH 拒绝审批时运行 PermissionDenied。 |
| PostToolUse / PostToolUseFailure | `tools/post-execute` | 生效 `updatedToolOutput`、拦截反馈与上下文。 |
| PostToolBatch | 结果之后的第一个 `agent/pre-step` | 拦截会拒绝该步骤。 |
| TaskCreated / TaskCompleted | `todo_write` | 新增或完成的待办即任务。拦截会拒绝整个调用。 |
| Stop | `agent/turn-stopping` | 拦截或 `additionalContext` 会引导 agent 继续。连续继续 8 次后停止（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`）。 |
| StopFailure | `agent/error` | 仅模型请求错误。 |
| SubagentStart / SubagentStop | `subagent/start` / `subagent/end` | agent 类型固定为 `general-purpose`。SubagentStop 不能让子 agent 继续运行。 |
| Notification | `approval/request`、`user-questions/request`、`agent/status` | 类型 `permission_prompt`、`agent_needs_input`、`idle_prompt`。 |
| MessageDisplay | `agent/assistant-stream` | 仅观察。`displayContent` 被忽略并给出警告。 |
| UserPromptExpansion | `session/event` 的 `command/run` | 仅观察。对所有命令运行，不限于 skill。 |
| CwdChanged、PreCompact、PostCompact | `session/event` | 仅观察。PreCompact hook 不能阻止压缩。 |
| PostModelSwitch | `agent/request` 调用配置中的提供方与模型 | 上下文并入下一步。`source` 固定为 `command`。仅提供方变化而模型名不变也算切换。 |
| TeammateIdle | `agent/status` 与 `team/member` | 拦截会引导队友继续工作。 |
| InstructionsLoaded | 插件自己的 rules 加载器 | 仅 `.claude/rules` 文件，`load_reason` 为 `session_start`。 |
| FileChanged | 轮询 matcher 指定的文件 | SessionStart、CwdChanged 与 FileChanged 返回的 `watchPaths` 也会被监视。 |
| ConfigChange | 轮询 settings 文件，以及 `skills/change` | 仅观察。hooks 在启动时加载且从不重新加载，所以 settings 文件变化时插件只记录日志，提示需要重启。 |

### 缺口：DSH 中无法实现的部分

以下 7 个事件无法运行，因为 DSH 没有对应的扩展点。settings 文件用到它们时，插件会给出警告并说明原因。

| 事件 | 无法运行的原因 |
|---|---|
| `Setup` | DSH 没有 init 或维护类启动参数。 |
| `DirectoryAdded` | DSH 只在启动时读取 `--add-dir`，不发出事件。 |
| `WorktreeCreate`、`WorktreeRemove` | worktree 操作是服务方法，没有 hook 点包裹它，所以 hook 无法替换它。 |
| `Elicitation`、`ElicitationResult` | DSH 的 MCP 客户端不支持 elicitation。 |
| `PreModelSwitch` | DSH 在插件看到之前就已应用模型切换，hook 无法阻止。`PostModelSwitch` 可以运行。 |

以下事件可以运行，但能力比 Claude Code 弱：

| 行为 | 差异 |
|---|---|
| `PreCompact`、`PostCompact`、`CwdChanged`、`MessageDisplay`、`UserPromptExpansion`、`ConfigChange` | 仅观察。DSH 事后才通知，hook 无法阻止或修改。 |
| `PreToolUse` 与 `PermissionRequest` 的 `updatedInput` | DSH 无法改写工具调用。PreToolUse 会询问用户；带 `updatedInput` 的 PermissionRequest `allow` 被忽略，交给常规审批者决定。两者都会给出警告。 |
| `MessageDisplay` 的 `displayContent` | 被忽略并给出警告。DSH 无法修改显示的文本。 |
| `SubagentStop` | 拦截不能让子 agent 继续运行。 |
| `SubagentStart` 与 `SubagentStop` 的 `agent_type` | 固定为 `general-purpose`。DSH 没有命名的子 agent 类型。 |
| `StopFailure` | 仅模型请求错误。 |
| `Notification` | 仅 `permission_prompt`、`agent_needs_input` 和 `idle_prompt`。 |
| `PostModelSwitch` 的 `source` | 固定为 `command`。 |
| `InstructionsLoaded` | 仅 `.claude/rules` 文件，`load_reason` 为 `session_start`。插件不加载其他指令文件，因此无法上报。 |
| `transcript_path` | 始终为空，因为 DSH 没有 transcript 文件。 |
| 重新加载 settings | hooks 在启动时加载。settings 文件变化只记录日志，需要重启。 |
| `agent` 处理器 | DSH 无法把子 agent 限制为只读工具。验证子 agent 内不运行 `agent` hook，其他 hooks 仍运行，因此拒绝守卫仍保护其工具调用。 |

处理器细节：

- `mcp_tool` 通过 DSH 工具服务调用 `mcp__<server>__<tool>`。`input` 字符串中的 `${path}` 取自 hook 输入。仍在连接的服务器视为 hook 失败。
- `prompt` 向会话模型提一个不带工具的问题。`model` 写成 `provider/model`，或写成会话 provider 的模型名。`continueOnBlock` 与 `impossible` 遵循 Claude Code 规则。
- `agent` 通过 `spawn` provider 启动 DSH 子 agent，并读取它的结构化回答。DSH 无法把它的工具限制为只读，所以提示词要求它不要修改任何文件，写入仍受 DSH 审批约束。验证子 agent 及其后代不会再次运行 `agent` hook；其他 hooks 仍运行，以保留工具拒绝守卫。

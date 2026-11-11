[← 项目首页](../../../README.zh-CN.md) · [English](../en/mcp.md)

# MCP 服务器

插件按以下来源读取 MCP 服务器，优先级从高到低。高优先级来源中的同名条目会覆盖下层的同名条目，并使用胜出来源的整条配置。插件服务器则按 URL 匹配。

| 来源 | 读取位置 |
|---|---|
| Managed | 系统 Claude 目录中的 `managed-mcp.json`。它独占控制：只加载此文件与 `managedMcpServers`。 |
| Managed settings | 系统 Claude 目录中 `managed-settings.json` 的 `managedMcpServers`。 |
| Local | `.claude.json` 中 `projects["<启动目录>"].mcpServers`。 |
| Project | `<projectRoot>/.mcp.json`。 |
| User | `.claude.json` 顶层的 `mcpServers`。设置了 `CLAUDE_CONFIG_DIR` 时位于该目录，否则位于主目录。 |
| Plugin | 插件自己的 `.mcp.json`，然后是 `plugin.json` 中每个 `mcpServers` 形式（路径或内联对象）。同名条目以后声明的为准。仅在开启 `enablePluginMcp` 时加载。 |

系统 Claude 目录在 macOS 为 `/Library/Application Support/ClaudeCode`，Linux 为 `/etc/claude-code`，Windows 为 `C:\Program Files\ClaudeCode`。

涉及策略时，失败会关闭：

- 无法读取的 `managed-settings.json` 会关闭所有 MCP 服务器。指向不存在文件的符号链接也算无法读取。
- 无法读取的 `managed-mcp.json` 会关闭用户、项目与本地服务器。`managedMcpServers` 仍会加载。
- 格式错误的 managed 策略会关闭所有 MCP 服务器。这包括不是列表的策略项、其中格式错误的条目（含无法解析的主机）、未设置的变量，以及不是布尔值的 `allowManagedMcpServersOnly`。
- 无法读取的用户、项目或本地文件会给出告警，并说明会停止什么。其中的条目不会被读取。

每条告警都会指明文件或条目，并说明哪些内容被关闭。

策略来自 settings 文件：

- `deniedMcpServers` 按 URL、命令或名称阻止服务器。拒绝列表始终优先。插件服务器同样遵守。
- 两个列表中的 `serverUrl` 模式都遵循 managed-MCP 的规则：完整写出的主机只匹配该协议的默认端口。
若要拒绝某主机的所有端口与协议，请写 `*://host:*`。
- `allowedMcpServers` 仅允许匹配的服务器。各 settings 文件的列表会合并，除非 managed settings 设置了 `allowManagedMcpServersOnly`。`managedMcpServers` 与 `managed-mcp.json` 中的服务器不受允许列表约束。
- 用户、项目或本地 settings 文件中格式错误的策略条目会被忽略并给出告警。managed settings 中的此类条目会关闭所有 MCP 服务器。不是列表的策略项：`allowedMcpServers` 视为允许零个服务器，`deniedMcpServers` 视为不拒绝任何服务器，并给出告警。
- 不带端口的 URL 模式只覆盖默认端口（`https` 为 443），与 Claude Code 文档一致。主机中含 `*` 或端口为 `*` 时覆盖所有端口。`serverCommand` 条目比较命令及其参数，不比较 `env`（与 Claude Code 文档一致），也不比较 `cwd`。 路径为 `/` 时只匹配根路径，写 `/*` 才匹配所有路径。
- 策略条目引用未设置的变量时，保留原文，并在告警中给出变量名与条目位置。在 managed settings 中，该条目会使整个 managed 策略失效并关闭所有服务器。
- 任一 settings 文件中的 `disabledMcpjsonServers` 按名称关闭项目服务器。
- `.claude.json` 中本项目下的 `disabledMcpServers` 按名称关闭用户与 managed 服务器。
- `managedMcpServers` 中的条目必须是固定的 `https://` 远程服务器。
它不能有 `command`、`args`、`env`、`headersHelper` 或 `${VAR}`，违反者会被跳过并给出告警。
`managed-mcp.json` 有自己的约定，不受此规则限制。
- 不是对象的条目（例如 `"bad": null`）会被跳过并给出告警，其他服务器仍会加载。
- 被禁用的条目，以及被同名的更高来源隐藏的条目，会被跳过并给出指明来源的告警。
- 没有 `plugin.json` 的插件目录仍会加载其根目录的 `.mcp.json`。
`mcpServers` 中的路径必须位于插件目录内，`${CLAUDE_PLUGIN_ROOT}` 即安装路径。
- 超过 Node 定时器最大延迟的 `timeout` 会被截断为该延迟，并给出告警。

条目处理：

- `command`、`args`、`env`、`url` 与 `headers` 中的 `${VAR}` 和 `${VAR:-default}` 会展开。未设置且无默认值的变量保留原文，并在告警中给出变量名。
- `timeout` 设置每次调用的时限（毫秒）。小于 1000 的值被忽略。
- `headersHelper` 在挂载时运行，时限 10 秒。其 JSON 输出覆盖静态 `headers`。运行失败的 helper 会跳过其服务器。在 `allowedMcpServers` 允许列表下，只有组织服务器可以使用 helper，因为列表无法看到 helper 的命令。
- 项目 `.mcp.json` 中的 `headersHelper` 是仓库提供的命令。
仅当 `mcpTrustProjectConfig` 为 `true` 时才运行，并且运行时不带用户的凭据变量。
名称含 `TOKEN`、`SECRET`、`PASS`、`KEY`、`AUTH`、`CRED`、`COOKIE` 或 `DSN` 的变量会被移除（Git 的 `GIT_CONFIG_KEY_<n>` 除外），`ANTHROPIC_CUSTOM_HEADERS` 以及值为带密码 URL 的变量也会被移除。
helper 收到的 `CLAUDE_CODE_MCP_SERVER_URL` 中，被移除变量的值会替换为 `REDACTED`。
受信任的项目 helper 仍是 shell 命令，可以读取用户的文件。
- 项目 `.mcp.json` 中的 `${VAR}` 不会读取凭据变量（同样的名称），除非 `mcpTrustProjectConfig` 为 `true`。
字面文本保持不变，日志会指出该变量。
这样仓库无法把凭据发送给它所指定的服务器。
该选项为 `false` 时，服务器只带静态 `headers` 挂载，日志会指出该服务器。
来自用户、本地或 managed 来源的 helper 保留用户的环境。
- `type: stdio` 与 `type: http`（或 `streamable-http`）会运行。有 `url` 但无 `type` 的条目会被跳过，与 Claude Code 一致。
- 字段类型错误（例如 `args` 中有非字符串项）会跳过该条目，告警中给出字段名。
- 传输方式不会读取的字段（例如 stdio 条目中的 `url`）会被报告为已忽略。
- stdio 服务器的环境中包含 `CLAUDE_PROJECT_DIR`。

### 缺口：DSH 中无法运行的部分

以下 Claude Code 功能在此无法运行。文件用到时插件会给出告警，条目的其余部分仍会加载。

| Claude Code 功能 | 无法运行的原因 |
|---|---|
| `type: sse` 与 `type: ws` | DSH 的 MCP 客户端只有 stdio 与 streamable-http。该条目被跳过。 |
| `oauth` | DSH 的 MCP 客户端没有 OAuth 流程。服务器在无 OAuth 的情况下加载，可能连接失败。 |
| `alwaysLoad` | DSH 在启动时加载全部工具，没有延迟加载工具的机制。该字段被忽略。 |
| 重连时的 `headersHelper` | DSH 只在挂载时设置一次 headers。重连或遇到 401 时 helper 不会再次运行。 |
| 插件服务器的 `headersHelper` | 不运行。带 helper 的插件服务器会被跳过并给出告警，因为它无法完成认证。 |
| 服务器下发的 managed settings、MDM 配置文件与注册表策略 | 只读取磁盘上的文件。 |
| `--mcp-config` 与 `--strict-mcp-config` | DSH 没有对应的启动参数。 |
| claude.ai 连接器 | 需要获取 claude.ai 账户数据。 |
| 插件 `mcpServers` 中的 MCP bundle（`.mcpb`、`.dxt`）与 URL | 不支持。该条目被跳过并给出告警。 |
| `enableAllProjectMcpServers` 与 `enabledMcpjsonServers` | 被忽略。项目服务器始终加载，与 `claude -p` 一致。DSH 没有审批提示。 |
| `enabledMcpServers` | 内置服务器的可选列表。DSH 没有内置 MCP 服务器。 |
| `agents/*.md` 中的子 agent `mcpServers` | 本插件不读取。相关工作见上游 PR #5（agent realm 中的 MCP）。 |
| 策略条目中的 `${VAR}` | 从实时进程环境展开。Claude Code 会固定该环境。 |
| 默认 `timeout` | 60 秒。Claude Code 约为 28 小时。 |

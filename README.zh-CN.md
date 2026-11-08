<p align="center">
  <img src="https://img.shields.io/badge/dsh-插件-blue?style=for-the-badge" alt="DSH 插件">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/🌐_English-Click_me-red?style=for-the-badge" alt="English"></a>
  <img src="https://img.shields.io/npm/dm/dsh-claude-compat?style=flat-square&label=downloads/month&color=brightgreen" alt="npm downloads/month">
  <img src="https://img.shields.io/npm/dt/dsh-claude-compat?style=flat-square&label=total%20downloads&color=blue" alt="npm total downloads">
  <img src="https://img.shields.io/npm/v/dsh-claude-compat?style=flat-square&label=version&color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

> **在 DSH 中复用 Claude Code 配置。**
> 桥接 skills、命令、规则、agents、hooks 与 MCP，并明确说明运行时限制和升级步骤。

---

## 10 秒速览

你已经在 Claude Code 里攒了一整套趁手的 `.claude/`——skills、斜杠命令、rules、agents、hooks、MCP servers。换到 **DSH (DeepSeek Harness)** 时，你不想把这些全部重新搭一遍。

**dsh-claude-compat 就是那座桥。** 它读取项目与用户级 Claude 配置，通过 DSH 原生服务暴露支持的内容。技能可在当前会话中重新加载；MCP 与 hook 配置变化需要重启 DSH。

```bash
dsh plugin --profile web add dsh-claude-compat@latest
dsh web
```

你的 skills 出现在 `/` 菜单里，规则注入新会话；`/agent-name` 通过 DSH 原生 skill 接口加载委派指令。

**或用 DSH 自己装（推荐）**：复制下面这句给 DSH，它会读 skill、自动安装并验证：

> 请阅读 https://github.com/biedongbin/dsh-claude-compat/blob/main/.claude/skills/install-dsh-compat/SKILL.md 并按步骤安装 dsh-claude-compat 插件。

> ⭐ 觉得好用？[点这里给个 star](https://github.com/biedongbin/dsh-claude-compat)——它让我们持续改进，也帮更多人找到这个插件。

---

## 1.2.0：原生管理与会话接续

侧栏「插件」中的 **Claude Code** 标签页提供已安装插件、发现插件、插件市场三个管理页，以及历史会话和桥接状态。1.2.1 支持 **DSH 0.2.1-rc.2 和 0.2.2-rc.1**，推荐使用 **Node.js 24**。后续采用滚动双版本维护策略：每次升级明确列出并验证两个受支持的 DSH 版本，用新版替换最旧条目，不预先承诺兼容尚未验证的未来版本。Hook 服务读取与工具执行修复见 [1.2.1 更新日志](CHANGELOG.zh-CN.md#121--2026-11-08)。

- **管理插件与市场**：可安装新插件、添加市场、搜索目录，以及启用、禁用、更新或卸载条目。列表默认每页 10 条，可选 10／20／50／100 条。
- **逐项提交操作**：每项独立显示排队、执行、结果和取消，其他条目仍可操作；写入同一份 Claude 配置和缓存的任务依次执行。变更通过 Claude CLI 的用户作用域完成，失败原因会显示，成功后刷新技能目录。种子和内联来源只读。
- **空白会话直接使用命令**：`/cc-plugin`、`/cc-resume` 无参数打开交互管理界面，不经过模型。首条输入就是管理命令时，结果显示在输入框上方；开始正常对话后由聊天视图接管。
- **交给 DSH 阅读历史**：会话可搜索和预览，一键恢复仅发送所选源文件路径和简短阅读指令。DSH 按需读取并简述背景、当前任务状态和下一步计划，不内联历史正文。管理页操作会在源项目工作区新建普通 DSH 会话；对话内的 `/cc-resume` 卡片使用当前会话，保留已有对话、目录和模型。
- **导出与刷新**：`/cc-export` 使用会话的有效工作目录，并在桌面版中解析真正的 Node 解释器；两个刷新命令都会等待目录刷新完成，并显示失败原因。

管理页、命令和 `claude_compat` 工具共用操作服务。界面操作要求已认证的所有者；工具访问用户级 Claude 配置和历史需要完整权限或当次批准。版本变更统一记录在 [1.2.0 更新日志](CHANGELOG.zh-CN.md#120--2026-11-06)。

### 现有配置升级

1. HTTP MCP 条目显式写 `"type": "http"`（或 `"streamable-http"`）。只有 URL、SSE 或 WebSocket 的条目会告警并跳过。
2. 除非信任项目，否则保持 `mcpTrustProjectConfig: false`。默认不运行项目 helper，凭据变量保持字面文本；详见 [MCP 服务器](#mcp-服务器)。
3. 启用前检查项目 hooks：插件没有工作区信任提示。更新后重启 DSH，从启动工作区重新加载 MCP 与 hooks。

更早的配置与旧式归档迁移说明见 [1.1.0 更新日志](CHANGELOG.zh-CN.md#110--2026-11-05)。

## 一键带过来的东西

| Claude Code 里的东西 | 在 DSH 里变成 | 怎么用 |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill（目录可加载） | `/skill-name`、`skill` 工具、模型目录都能看到 |
| `commands/*.md` | DSH skill（用户可调） | `/command-name` 出现在斜杠菜单 |
| `rules/*.md` | 消息流注入（同 Claude 的 `prependUserContext` 通道） | 每个新会话自动生效 |
| `agents/*.md` | 委派 shim skill | `/agent-name` 按角色调起 |
| `.mcp.json`、`.claude.json`、`managed-mcp.json` | `dsh-mcp-client` 实例 | stdio / streamable-http 自动翻译 |
| `.claude/settings.json` hooks | 33 个事件中的 26 个，`command`、`http`、`mcp_tool`、`prompt`、`agent` 处理器 | 命令、权限、拦截照旧 |
| `~/.claude/plugins` | DSH skill（`/cc-plugin` 管理） | 安装的插件技能一并可用 |

同一套目录，项目 `.claude/` 和用户级 `~/.claude/` **都会读**。同名项按固定优先级去重：**项目 `.claude` > DSH 原生 > `~/.claude`**——项目技能永远覆盖其他副本，用户技能永远不覆盖 DSH 原生。`CLAUDE.md` / `AGENTS.md` 由 DSH 内置的 `dsh-agent-instructions` 处理，**本插件不碰**。

## 功能（实现细节）

| `.claude/` 路径 | 机制 | 行为 |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill provider | 仅 name + description 进模型可见目录；正文按需加载（`skill` 工具）。新增 skill 下次 catalog 刷新即出现，无需重启。 |
| `commands/*.md` | DSH skill provider | 同上，且用户可直接调用：斜杠菜单里 `/command-name` 可用。 |
| `rules/*.md` | 消息流注入 | rules 全文拼接，包 `<system-reminder>` 信封，每会话一次以 user-role 消息插在消息数组最前 —— 与 Claude Code 同通道（`prependUserContext`），模型可靠遵循。 |
| `agents/*.md` | DSH skill provider（委派 shim） | DSH 没有 markdown 子代理格式，因此每个 agent 文件变成 **skill**，正文开头带显式"以此人设委派子代理"指令。模型与用户均可调用，`/agent-name` 可用。同名 agent 与 skill 一样按 rank 去重。 |
| `managed-mcp.json`、`managedMcpServers`、`.claude.json`、`<projectRoot>/.mcp.json` | MCP 服务器 | Claude Code 格式的 MCP 服务器定义按 Claude Code 的优先级读取，并在 DSH 启动时（启动工区）挂载为 `dsh-mcp-client` 插件实例：`command` → stdio，`type: http` → streamable-http。畸形条目或缺少 `@deepseek-ai/dsh-mcp-client` 时降级为告警，绝不崩溃。见 [MCP 服务器](#mcp-服务器)。 |
| `.claude/settings.json` → `hooks` | Hooks | Claude Code hooks，桥接到 DSH 扩展点。见 [Hooks](#hooks)。 |
| `~/.claude/plugins`（已安装插件） | DSH skill provider | 已安装的 Claude Code 插件市场插件贡献其 skills/commands/agents（读取每个安装的 `.claude-plugin/plugin.json` 清单，无清单时回退目录扫描），rank `750` —— 长尾：project `.claude`、DSH 原生、`~/.claude` 在同名冲突时全部优先。插件的 MCP 服务器（清单 `mcpServers`）仅在显式开启 `enablePluginMcp` 后挂载 —— 挂载第三方 MCP 比列出 skills 信任门槛更高。 |

同类目录同样读取**用户级** `~/.claude/`（skills、commands、rules、agents 与 `~/.claude/settings.json` hooks）。同名 skill/command/rule/agent 去重，优先级固定：

**项目 `.claude` > DSH 原生（`.dsh`）> `~/.claude`**

- 项目 `.claude` 条目 rank=`50`；DSH 自身 skills —— 项目 `.dsh` 根、`.agents` 根与 bundled skills（rank=`100`–`600`，`BUNDLED_SKILL_RANK`）—— 位于两者之间；`~/.claude` 条目 rank=`700`。项目 skill 永远压过 DSH 原生与用户副本；用户 skill 永远压不过 DSH 原生。
- `~/.claude/rules` 中与项目同 basename 的 rule 文件被跳过（项目优先）。

`CLAUDE.md` / `AGENTS.md` **不碰** —— DSH 内置 `dsh-agent-instructions` 已处理。

## 内置命令

安装本插件后可使用五个原生管理命令：

| 命令 | 作用 |
|---|---|
| `/cc-plugin` | 打开插件管理界面，或使用 `list`、`install <名>[@市场]`、`uninstall`、`enable`、`disable`、`update [名]`、`search <词>`、`marketplace list\|add\|remove\|update`。`/cc-plugin <名>@<市场>` 可直接安装。变更要求 `claude` CLI，并使用用户作用域；CLI 缺失、认证或网络错误会明确报告，不会降级为直接写 JSON 或 git 文件。Claude Code 与 DSH 读取同一份配置的插件注册表和设置。 |
| `/reload-cc-plugins` | 刷新**当前会话**的技能目录，等待刷新完成并报告失败。新增或移除的技能无需新建会话即可出现；MCP 与 hook 变更仍需重启 DSH。 |
| `/reload-skills` | `/reload-cc-plugins` 的别名。 |
| `/cc-export` | 列出或导出 DSH 原生 skill（`.dsh/skills`）到 Claude Code `.claude/skills/<name>/SKILL.md`，保留 frontmatter。使用会话的有效工作目录，桌面版通过真正的 Node 解释器执行。`list` / `export [--overwrite] [--target <目录>]`；相对目标路径按有效工作目录解析。 |
| `/cc-resume` | 浏览 Claude 历史并把背景交给 DSH 接续。对话内的卡片直接续接当前 DSH 会话；管理页的一键恢复在源项目工作区新建普通 DSH 会话。`list` / `resume <Claude sessionId> [--cwd 源目录] [--limit-turns N]`；`import` 是 `resume` 的别名，`archive` 才是旧式历史归档副本。 |

典型闭环：`/cc-plugin install ralph-loop@claude-plugins-official` → `/reload-cc-plugins` → 新技能立即可见。插件自带的 MCP 服务器仍需重启 DSH（进程级挂载）。

### 上下文接续与旧式归档

一键恢复只定位配置的 Claude `projects/` 源文件，并发送文件路径及简短的阅读总结指令。DSH 按需读取文件，先概述背景、当前任务状态和下一步计划；插件不内联正文、不扫描全文，也不自动执行历史待办。源文件查找位置和目标 DSH 会话身份分别传递，Claude 历史中途切换目录不会阻止接续。

原生界面与命令使用配置的 `userClaudeDir`。可用 `/cc-resume resume <id> --cwd <源项目>` 选择其他项目历史，同时在发起命令的 DSH 会话继续。显式 `archive` 和 `sessions.import` 仍保留为独立归档操作，并保留已有 DSH 日志。独立 CLI 是旧格式工具，不参与一键恢复。

## 环境要求

- DSH 及其 profile（如 `web`）
- 使用 Claude Code 约定的项目：`.claude/skills/`、`.claude/commands/`、`.claude/rules/`、`.claude/agents/`、`.claude/settings.json` 与项目根 `.mcp.json`（均可选；`~/.claude/` 对应目录同样生效）
- `PATH` 上有 `pnpm` —— `dsh plugin` 是 pnpm 的薄转发层

## 安装 / 更新

一条命令 —— 包声明了 `dsh.bundle`，DSH 自动激活（无需手改 `cordis.patch.yml`）。安装或更新到最新版：

```bash
dsh plugin --profile web add dsh-claude-compat@latest
```

或从 GitHub：

```bash
dsh plugin --profile web add github:biedongbin/dsh-claude-compat
```

重启 DSH（`dsh web`）。完成 —— skills 出现在 `/` 菜单，rules 注入每个新会话。

## 配置

| 选项 | 默认值 | 说明 |
|---|---|---|
| `enableSkills` | `true` | 注册 `.claude/skills` + `.claude/commands` + `.claude/agents` provider（项目与 `~/.claude` 均含） |
| `enableRules` | `true` | 注入项目 + `~/.claude` 的 `rules/*.md` 到消息流 |
| `enableMcp` | `true` | 将 managed、本地、项目与用户 MCP 定义挂载为原生 MCP 客户端插件；插件定义另需 `enablePluginMcp` |
| `mcpTrustProjectConfig` | `false` | 信任项目 `.mcp.json`：其 `headersHelper` 会运行（不带用户的凭据变量），其 `${VAR}` 可读取凭据变量。关闭时服务器只带静态 headers 与字面文本挂载 |
| `mcpFailOnStartupError` | `false` | 转发给 `dsh-mcp-client`：MCP 服务器连接失败时让插件启动失败 |
| `enableHooks` | `true` | 运行 `.claude/settings.json` 文件中的 hooks（见 [Hooks](#hooks)） |
| `hooksTimeoutMs` | `60000` | 每个 hook 的默认运行超时，单位毫秒，取值 1 至 2147483647。hook 自身的 `timeout`（单位秒）优先生效。与 Claude Code 一致，SessionEnd 默认 1.5 秒，UserPromptSubmit 与 PostModelSwitch 默认 30 秒，MessageDisplay 默认 10 秒；prompt hook 默认 30 秒，agent hook 默认 60 秒 |
| `enableAgents` | `true` | 把 `.claude/agents/*.md` 暴露为委派 shim skill |
| `skillAliases` | `{}` | 非 kebab 名（中文等）→ ASCII slug 的映射，如 `{ "三脑": "san-nao" }`。见下方「中文 / 非 ASCII 技能名」 |
| `aliasDescriptionPrefix` | `true` | 用了 alias 时把原名放在描述最前：`san-nao: 三脑 — …` |
| `rulesMaxBytes` | `65536` | 注入项目 rules 总量硬上限 |
| `userRulesMaxBytes` | `65536` | 注入 `~/.claude/rules` 总量硬上限 |
| `projectRootMarkers` | `[".git"]` | 项目根发现的祖先标记；整条祖先链都没有标记时，会话 cwd 自身即项目根 |
| `skillRank` | `50` | 项目 `.claude` skills 的 provider 排名（压过一切 DSH 原生冲突） |
| `skillSource` | `project-claude` | 项目 catalog 条目来源标签 |
| `userSkillRank` | `700` | `~/.claude` skills 的 provider 排名（输给 DSH 原生 `600`） |
| `userSkillSource` | `user-claude` | `~/.claude` catalog 条目来源标签 |
| `userClaudeDir` | 未设置 | 用户级 `.claude` 目录（`~` 展开为 home 目录）。未设置时依次使用 `CLAUDE_CONFIG_DIR`、`~/.claude` |
| `enablePlugins` | `true` | 暴露已安装 Claude Code 插件（`~/.claude/plugins`）的 skills/commands/agents |
| `pluginSkillRank` | `750` | 插件内容的 provider 排名（长尾 —— 其他一切优先） |
| `pluginSkillSource` | `claude-plugin` | 插件目录条目来源标签 |
| `pluginsRoot` | 未设置 | 插件市场根目录（`installed_plugins.json` + `cache/`）。未设置时依次使用 `CLAUDE_CODE_PLUGIN_CACHE_DIR`、`<用户配置目录>/plugins` |
| `enablePluginMcp` | `false` | 挂载插件声明的 MCP 服务器（需显式开启；要求 `enablePlugins` 与 `enableMcp`）。范围包含插件目录读取到的所有插件，其中有来自 `CLAUDE_CODE_PLUGIN_SEED_DIR` 和 `CLAUDE_CODE_PLUGIN_DIRS` 的插件 |
| `enablePluginManager` | `true` | 注册 `/cc-plugin`、`/reload-cc-plugins`、`/reload-skills` 管理 skill |
| `pluginManagerRank` | `40` | 内置管理 skill 的 rank（catalog 顶部） |

### Claude Code 环境变量

插件读取 Claude Code 用来改变默认位置的同一组环境变量。
显式配置项优先于环境变量，环境变量优先于 `~/.claude` 默认值。
`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_PLUGIN_CACHE_DIR`、`CLAUDE_CODE_PLUGIN_SEED_DIR` 必须是绝对路径。相对路径会使插件不激活，并输出一行指明变量名的错误。
插件只检查实际用到的变量：显式配置的 `userClaudeDir` 或 `pluginsRoot` 会覆盖其对应变量，被覆盖的变量取值错误不会报错。
`userClaudeDir` 与 `pluginsRoot` 未设置时使用下表的变量。

| 变量 | 作用 |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | 替代 `~/.claude`：settings、rules、skills、commands、agents 与会话历史 |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR` | 替代插件根目录（`~/.claude/plugins`） |
| `CLAUDE_CODE_PLUGIN_SEED_DIR` | 额外的只读插件根目录，Unix 用 `:` 分隔，Windows 用 `;`。同名时主根目录优先。插件文件从当前种子路径读取，因此种子可以挂载在与构建时不同的路径 |
| `CLAUDE_CODE_PLUGIN_DIRS` | 本次会话加载的插件目录，分隔符相同。每个条目须为绝对路径或以 `~` 开头；其他条目以及不是目录的条目会被跳过并给出警告。此处的插件会整体替换同一清单名称的已安装插件 |
| `CLAUDE_CODE_PROJECT_DIR_NAME` | `/cc-resume` 读取的 `projects/` 下的单个文件夹名，替代由工作目录推导的名称。仅在同时设置了 `CLAUDE_CONFIG_DIR` 时生效，且只接受 1 到 64 个字母、数字、连字符或下划线；其他值会被 Claude Code 忽略，插件也同样忽略 |

## Hooks

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

## MCP 服务器

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

## 说明

- **Skill 命名**：DSH 要求 kebab-case。嵌套 skill 目录扁平化（`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`）；frontmatter 名字非法时回退目录名。
- **MCP 生命周期**：MCP 配置文件仅在 DSH 启动时（启动工区）读取一次，每个服务器随进程生命周期挂载 —— 非按会话。修改后需重启 DSH。
- **项目级 hook**：插件没有工作区信任提示。`<project>/.claude/settings.json` 或 `<project>/.claude/settings.local.json` 中的 hook 会在 DSH 打开该项目时以你的权限运行，请只打开你信任的项目。
  插件只在启动时读取一次项目设置，读取的是 DSH 启动时所在的目录，而不是每个会话的目录。PermissionRequest hook 还会收到 DSH 发起请求的 `reason`，因此可以区分沙箱升级与普通审批。
- **Hooks 范围**：33 个 Claude Code hook 事件中有 26 个可运行，五种处理器类型都支持。每个事件对应的 DSH 扩展点以及无法运行的事件见 [Hooks](#hooks)。
- **Rules 粒度**：每个新会话读取（按会话 cwd 缓存）。会话中改 rule，下一会话生效。
- **Rules 内容**：rules 原文注入为模型指令。只提交你想让模型遵循的 rule —— 信任级别同 `CLAUDE.md`。
- **Catalog 快照时机**：skill catalog 在会话创建时快照。会话中途安装/修改的 skill 通过 `/reload-cc-plugins` 热生效，或下一会话生效。

### 中文 / 非 ASCII 技能名

DSH 的技能名文法写死为 kebab-case（`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，定义在 `@deepseek-ai/dsh-skill`，registry 取用前先校验），所以**中文名无论插件怎么发都进不了 registry** —— 插件层放行也没用，下一层立刻 `return void 0`。

本插件的做法：把中文名显式映射成一个合法 slug，原名保留在描述最前，目录里读起来仍是中文：

```yaml
skillAliases:
  三脑: tri-brain
  读知乎: read-zhihu
```

- 映射后 `name` 用 slug（斜杠菜单里是 `/tri-brain`），`description` 变成 `三脑 — 三脑复核（…）`。
- **合法名永远压过映射**：本来就能加载的技能不会被 alias 改名。
- 别名条目沿用原 provider 的 rank，所以与 DSH 原生或 `~/.agents` 同名时，按原有优先级去重（`~/.claude` 的 alias 输给 `~/.agents` 同名项，不会顶掉它）。想让 `~/.claude` 赢就把 `userSkillRank` 调到 500 以下。
- 没配映射的非 kebab 名不再静默消失：每个文件每进程告警一次，并直接给出可粘贴的映射示例。

## 故障排查

### 旧式归档 CLI

独立 CLI 用于旧式历史归档，与原生文件引用接续是两条路径。创建归档时显式传入项目和自定义 Claude 配置目录：

```bash
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs list --cwd /path/to/project
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs import <sessionId> --cwd /path/to/project --user-claude-dir /path/to/claude-config
```

**重启后 DSH 起不来 / 3080 端口卡死。** 旧进程占着端口（日志特征 `EADDRINUSE`）。用自带重启脚本 —— 干净等待停止、SIGKILL 兜底、探活端口后才报成功：

```bash
npx dsh-claude-compat-restart        # bin 别名（装包即得）
bash node_modules/dsh-claude-compat/scripts/dsh-restart.sh   # 直接跑
bash scripts/dsh-restart.sh --no-patch   # 跳过 prompt 补丁，只重启
```

脚本同时会重新幂等打 `dsh-terminal-bash` 的 prompt 补丁（npx/npm 更新会悄悄还原它）。`DSH_RESTART_PORT` 可覆盖端口（默认 3080）。

**`/cc-plugin` 装了插件但技能没出现。** 先 `/reload-cc-plugins`。仍没有 → 重启 DSH（插件自带 MCP 服务器必须重启）。

**旧式归档 CLI 报压缩错误。** 该独立工具需要 `zstd`（macOS：`brew install zstd`）。原生 `/cc-resume` 的文件引用接续不压缩会话，无需 `zstd` 二进制。

**`/cc-plugin` 提示 claude CLI 不可用。** 安装 Claude Code（`npm install -g @anthropic-ai/claude-code`）后再变更插件或市场。仍可浏览本地目录；变更失败不会降级为直接修改注册表。

## 更新日志

- **[1.2.0](CHANGELOG.zh-CN.md#120--2026-11-06)（[English](CHANGELOG.md#120--2026-11-06)）** — 原生管理、文件引用会话接续与命令修复。
- **[完整更新日志](CHANGELOG.zh-CN.md)（[English](CHANGELOG.md)）** — 全部版本历史。

## 社区鸣谢

- [Linux.do](https://linux.do) —— 社区
- [Claude Code](https://claude.com/claude-code) —— 本插件桥接的 `.claude/` 约定
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) —— 本插件扩展的运行时

## License

[MIT](LICENSE)

## 📈 NPM 下载趋势

![NPM Downloads](.github/assets/downloads.svg)

[Data: api.npmjs.org](https://www.npmjs.com/package/dsh-claude-compat) · [npmtrends](https://npmtrends.com/dsh-claude-compat/)

## ⭐ Star History

如果这个项目对你有帮助，请给个 ⭐ —— 这是我们持续改进的动力。

<p align="center">
  <img src="https://img.shields.io/github/stars/biedongbin/dsh-claude-compat?style=for-the-badge&logo=github&color=gold" alt="GitHub Stars">
  <img src="https://img.shields.io/github/forks/biedongbin/dsh-claude-compat?style=for-the-badge&logo=github" alt="GitHub Forks">
  <img src="https://img.shields.io/github/watchers/biedongbin/dsh-claude-compat?style=for-the-badge&logo=github" alt="GitHub Watchers">
</p>

<div align="center">
  <a href="https://www.star-history.com/#biedongbin/dsh-claude-compat&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=biedongbin/dsh-claude-compat&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=biedongbin/dsh-claude-compat&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=biedongbin/dsh-claude-compat&type=Date" width="760" />
    </picture>
  </a>
</div>

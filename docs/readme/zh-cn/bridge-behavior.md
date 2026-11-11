[← 项目首页](../../../README.zh-CN.md) · [English](../en/bridge-behavior.md)

# 一键带过来的东西

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
| `managed-mcp.json`、`managedMcpServers`、`.claude.json`、`<projectRoot>/.mcp.json` | MCP 服务器 | Claude Code 格式的 MCP 服务器定义按 Claude Code 的优先级读取，并在 DSH 启动时（启动工区）挂载为 `dsh-mcp-client` 插件实例：`command` → stdio，`type: http` → streamable-http。畸形条目或缺少 `@deepseek-ai/dsh-mcp-client` 时降级为告警，绝不崩溃。见 [MCP 服务器](mcp.md#mcp-服务器)。 |
| `.claude/settings.json` → `hooks` | Hooks | Claude Code hooks，桥接到 DSH 扩展点。见 [Hooks](hooks.md#hooks)。 |
| `~/.claude/plugins`（已安装插件） | DSH skill provider | 已安装的 Claude Code 插件市场插件贡献其 skills/commands/agents（读取每个安装的 `.claude-plugin/plugin.json` 清单，无清单时回退目录扫描），rank `750` —— 长尾：project `.claude`、DSH 原生、`~/.claude` 在同名冲突时全部优先。插件的 MCP 服务器（清单 `mcpServers`）仅在显式开启 `enablePluginMcp` 后挂载 —— 挂载第三方 MCP 比列出 skills 信任门槛更高。 |

同类目录同样读取**用户级** `~/.claude/`（skills、commands、rules、agents 与 `~/.claude/settings.json` hooks）。同名 skill/command/rule/agent 去重，优先级固定：

**项目 `.claude` > DSH 原生（`.dsh`）> `~/.claude`**

- 项目 `.claude` 条目 rank=`50`；DSH 自身 skills —— 项目 `.dsh` 根、`.agents` 根与 bundled skills（rank=`100`–`600`，`BUNDLED_SKILL_RANK`）—— 位于两者之间；`~/.claude` 条目 rank=`700`。项目 skill 永远压过 DSH 原生与用户副本；用户 skill 永远压不过 DSH 原生。
- `~/.claude/rules` 中与项目同 basename 的 rule 文件被跳过（项目优先）。

`CLAUDE.md` / `AGENTS.md` **不碰** —— DSH 内置 `dsh-agent-instructions` 已处理。

## 说明

- **Skill 命名**：DSH 要求 kebab-case。嵌套 skill 目录扁平化（`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`）；frontmatter 名字非法时回退目录名。
- **MCP 生命周期**：MCP 配置文件仅在 DSH 启动时（启动工区）读取一次，每个服务器随进程生命周期挂载 —— 非按会话。修改后需重启 DSH。
- **项目级 hook**：插件没有工作区信任提示。`<project>/.claude/settings.json` 或 `<project>/.claude/settings.local.json` 中的 hook 会在 DSH 打开该项目时以你的权限运行，请只打开你信任的项目。
  插件只在启动时读取一次项目设置，读取的是 DSH 启动时所在的目录，而不是每个会话的目录。PermissionRequest hook 还会收到 DSH 发起请求的 `reason`，因此可以区分沙箱升级与普通审批。
- **Hooks 范围**：33 个 Claude Code hook 事件中有 26 个可运行，五种处理器类型都支持。每个事件对应的 DSH 扩展点以及无法运行的事件见 [Hooks](hooks.md#hooks)。
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

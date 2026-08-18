<p align="center">
  <img src="https://img.shields.io/badge/dsh-插件-blue?style=for-the-badge" alt="DSH 插件">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/🌐_English-Click_me-red?style=for-the-badge" alt="English"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.2-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

<p align="center">DeepSeek Harness 插件：把 Claude Code 的 <code>.claude/</code> 目录原生桥接进 DSH —— skills、斜杠命令、rules、agents、hooks、MCP 服务器零迁移直接复用。</p>

## 功能

| `.claude/` 路径 | 机制 | 行为 |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill provider | 仅 name + description 进模型可见目录；正文按需加载（`skill` 工具）。新增 skill 下次 catalog 刷新即出现，无需重启。 |
| `commands/*.md` | DSH skill provider | 同上，且用户可直接调用：斜杠菜单里 `/command-name` 可用。 |
| `rules/*.md` | 消息流注入 | rules 全文拼接，包 `<system-reminder>` 信封，每会话一次以 user-role 消息插在消息数组最前 —— 与 Claude Code 同通道（`prependUserContext`），模型可靠遵循。 |
| `agents/*.md` | DSH skill provider（委派 shim） | DSH 没有 markdown 子代理格式，因此每个 agent 文件变成 **skill**，正文开头带显式"以此人设委派子代理"指令。模型与用户均可调用，`/agent-name` 可用。同名 agent 与 skill 一样按 rank 去重。 |
| `.claude/settings.json` → `hooks` | 工具/Prompt 钩子 | Claude Code hooks 子集桥接到 DSH 的 `tools/pre-execute`（PreToolUse）、`tools/post-execute`（PostToolUse）与 `agent/pre-step`（UserPromptSubmit）瀑布。命令经 `/bin/sh -c` 运行，stdin 携带 Claude 风格 JSON；exit 2 拒绝/阻断，`hookSpecificOutput` 覆盖生效，超时放行并告警。 |
| `<projectRoot>/.mcp.json` | MCP 服务器 | Claude Code 格式的 MCP 服务器定义在 DSH 启动时（启动工区）翻译成 `dsh-mcp-client` 插件实例：`command` → stdio，`url` → streamable-http。畸形条目或缺少 `@deepseek-ai/dsh-mcp-client` 时降级为告警，绝不崩溃。 |
| `~/.claude/plugins`（已安装插件） | DSH skill provider | 已安装的 Claude Code 插件市场插件贡献其 skills/commands/agents（读取每个安装的 `.claude-plugin/plugin.json` 清单，无清单时回退目录扫描），rank `750` —— 长尾：project `.claude`、DSH 原生、`~/.claude` 在同名冲突时全部优先。插件的 MCP 服务器（清单 `mcpServers`）仅在显式开启 `enablePluginMcp` 后挂载 —— 挂载第三方 MCP 比列出 skills 信任门槛更高。 |

同类目录同样读取**用户级** `~/.claude/`（skills、commands、rules、agents 与 `~/.claude/settings.json` hooks）。同名 skill/command/rule/agent 去重，优先级固定：

**项目 `.claude` > DSH 原生（`.dsh`）> `~/.claude`**

- 项目 `.claude` 条目 rank=`50`；DSH 自身 skills —— 项目 `.dsh` 根、`.agents` 根与 bundled skills（rank=`100`–`600`，`BUNDLED_SKILL_RANK`）—— 位于两者之间；`~/.claude` 条目 rank=`700`。项目 skill 永远压过 DSH 原生与用户副本；用户 skill 永远压不过 DSH 原生。
- `~/.claude/rules` 中与项目同 basename 的 rule 文件被跳过（项目优先）。

`CLAUDE.md` / `AGENTS.md` **不碰** —— DSH 内置 `dsh-agent-instructions` 已处理。

## 内置命令

安装本插件后 catalog 多出三个管理 skill：

| 命令 | 作用 |
|---|---|
| `/cc-plugin` | 完整 Claude Code 插件管理：`list`、`install <名>[@市场]`、`uninstall`、`enable`、`disable`、`update [名]`、`search <词>`、`marketplace list\|add\|remove\|update`。一键语法 `/cc-plugin <名>@<市场>` 直接安装。引擎：有 `claude` CLI 时优先调度，否则内置降级（直接操作 JSON + git，被改文件自动时间戳备份）。状态全部落在 Claude 原生位置（`~/.claude/plugins`、`~/.claude/settings.json` 的 `enabledPlugins`），Claude Code 与 DSH 读同一份真相。 |
| `/reload-cc-plugins` | 热重载 skill catalog：清缓存并广播变更，新装/卸载的插件技能**当前会话**立即可见 —— 无需重启、无需新会话。 |
| `/reload-skills` | `/reload-cc-plugins` 的别名。 |

典型闭环：`/cc-plugin install ralph-loop@claude-plugins-official` → `/reload-cc-plugins` → 新技能立即可见。插件自带的 MCP 服务器仍需重启 DSH（进程级挂载）。

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
| `enableMcp` | `true` | 把 `<projectRoot>/.mcp.json` 翻译为挂载的 MCP 服务器插件 |
| `mcpFailOnStartupError` | `false` | 转发给 `dsh-mcp-client`：MCP 服务器连接失败时让插件启动失败 |
| `enableHooks` | `true` | 运行 `.claude/settings.json` hooks（Pre/PostToolUse、UserPromptSubmit） |
| `hooksTimeoutMs` | `60000` | 单个 hook 运行超时（UserPromptSubmit 无论如何上限 10s） |
| `enableAgents` | `true` | 把 `.claude/agents/*.md` 暴露为委派 shim skill |
| `rulesMaxBytes` | `65536` | 注入项目 rules 总量硬上限 |
| `userRulesMaxBytes` | `65536` | 注入 `~/.claude/rules` 总量硬上限 |
| `projectRootMarkers` | `[".git"]` | 项目根发现的祖先标记 |
| `skillRank` | `50` | 项目 `.claude` skills 的 provider 排名（压过一切 DSH 原生冲突） |
| `skillSource` | `project-claude` | 项目 catalog 条目来源标签 |
| `userSkillRank` | `700` | `~/.claude` skills 的 provider 排名（输给 DSH 原生 `600`） |
| `userSkillSource` | `user-claude` | `~/.claude` catalog 条目来源标签 |
| `userClaudeDir` | `~/.claude` | 用户级 `.claude` 目录（`~` 展开为 home 目录） |
| `enablePlugins` | `true` | 暴露已安装 Claude Code 插件（`~/.claude/plugins`）的 skills/commands/agents |
| `pluginSkillRank` | `750` | 插件内容的 provider 排名（长尾 —— 其他一切优先） |
| `pluginSkillSource` | `claude-plugin` | 插件目录条目来源标签 |
| `pluginsRoot` | `~/.claude/plugins` | 插件市场根目录（`installed_plugins.json` + `cache/`） |
| `enablePluginMcp` | `false` | 挂载插件声明的 MCP 服务器（需显式开启；要求 `enablePlugins` 与 `enableMcp`） |
| `enablePluginManager` | `true` | 注册 `/cc-plugin`、`/reload-cc-plugins`、`/reload-skills` 管理 skill |
| `pluginManagerRank` | `40` | 内置管理 skill 的 rank（catalog 顶部） |

## 说明

- **Skill 命名**：DSH 要求 kebab-case。嵌套 skill 目录扁平化（`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`）；frontmatter 名字非法时回退目录名。
- **MCP 生命周期**：`.mcp.json` 仅在 DSH 启动时（启动工区）读取一次，每个服务器随进程生命周期挂载 —— 非按会话。修改后需重启 DSH。
- **Hooks 范围**：刻意只实现 Claude Code hooks 的一个小子集：PreToolUse / PostToolUse / UserPromptSubmit。matcher 支持精确名、`*` 通配与 `|` 或；命令 stdin 携带 Claude 风格 JSON。exit 2 = 拒绝（Pre）/ 阻断（Post）；其它非零退出与超时放行并告警。
- **Rules 粒度**：每个新会话读取（按会话 cwd 缓存）。会话中改 rule，下一会话生效。
- **Rules 内容**：rules 原文注入为模型指令。只提交你想让模型遵循的 rule —— 信任级别同 `CLAUDE.md`。
- **Catalog 快照时机**：skill catalog 在会话创建时快照。会话中途安装/修改的 skill 通过 `/reload-cc-plugins` 热生效，或下一会话生效。

## 故障排查

**重启后 DSH 起不来 / 3080 端口卡死。** 旧进程占着端口（日志特征 `EADDRINUSE`）。用自带重启脚本 —— 干净等待停止、SIGKILL 兜底、探活端口后才报成功：

```bash
npx dsh-claude-compat-restart        # bin 别名（装包即得）
bash node_modules/dsh-claude-compat/scripts/dsh-restart.sh   # 直接跑
bash scripts/dsh-restart.sh --no-patch   # 跳过 prompt 补丁，只重启
```

脚本同时会重新幂等打 `dsh-terminal-bash` 的 prompt 补丁（npx/npm 更新会悄悄还原它）。`DSH_RESTART_PORT` 可覆盖端口（默认 3080）。

**`/cc-plugin` 装了插件但技能没出现。** 先 `/reload-cc-plugins`。仍没有 → 重启 DSH（插件自带 MCP 服务器必须重启）。

**`/cc-plugin` 提示 claude CLI 不可用。** 降级引擎已覆盖 install/enable/disable；marketplace add/update 需要安装 Claude Code（`npm install -g @anthropic-ai/claude-code`）或直接在 Claude Code 里管理市场。

## 社区鸣谢

- [Linux.do](https://linux.do) —— 社区
- [Claude Code](https://claude.com/claude-code) —— 本插件桥接的 `.claude/` 约定
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) —— 本插件扩展的运行时

## License

[MIT](LICENSE)

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

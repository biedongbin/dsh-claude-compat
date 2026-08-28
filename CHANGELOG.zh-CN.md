# 更新日志

[English](CHANGELOG.md) | 简体中文

本项目所有重要变更记录于此。版本遵循 [SemVer](https://semver.org/)。

## [0.8.0] — 2026-08-19

### 新增
- **会话生命周期 hooks**：`SessionStart` → `agent/session-start`，`SessionEnd` → `agent/disposed`。fire-and-forget（尽力而为，非零退出仅告警，不阻塞循环）。载荷含 `session_id` + `cwd`。
- **`/cc-export`**：把 DSH 原生 skill（`.dsh/skills`）导出为 Claude Code `.claude/skills/<name>/SKILL.md`，frontmatter 保留；多行值输出为 YAML literal block。`list` / `export [--overwrite] [--target]`。

### 修复
- **session hook agent 提取**：DSH agent 事件 dispatch `(carrier, name, payload)`，agent 在**第一个参数**（`carrier.agent`）而非 payload — 已在隔离沙箱实测。监听器改为 `carrier?.agent ?? payload?.agent`（防御 agent-loop 的 fused-payload 路径）。此前 `session_id` 恒为 `'unknown'`。

## [0.7.0] — 2026-08-18

### 新增
- **`/cc-resume` — Claude Code 会话恢复**：列出 `~/.claude/projects/<munged-cwd>/*.jsonl` 中的会话（id、日期、消息数、首条用户消息预览、已导入标记），可将任意会话导入 DSH，生成原生事件日志（`~/.dsh/sessions/<munged>/session-cc-<id>/session.jsonl.zstd`）。导入会话完整保留 user/assistant/工具调用历史，以 `cc: <预览>` 标题出现在 DSH 会话列表，可像原生会话一样打开续聊。
- 翻译规则：仅主线程（跳过 Claude sidechain 子代理消息）；丢弃 thinking 块（DSH reasoning 基于流式 chunk）；tool_use/tool_result 配对为 DSH `tool/call`/`tool/result` 事件；`--limit-turns N` 只导超大会话的最近 N 轮；重复导入幂等。
- **zstd frame 布局修复**：会话 header 行独立压缩为第一个 zstd 帧（DSH 的 `assertZstdHeaderFrame` 要求），事件体随后为第二帧 — 此前整包单帧压缩导致 DSH 解析导入日志失败。
- `scripts/cc-resume.mjs` 亦可独立作为 CLI 使用（`list` / `import <sessionId>`）；需要 PATH 上有 `zstd` 二进制。

### 已知问题
- `skill` 工具在 agent scoped 运行层可能无法解析插件提供的 skill（报 `unknown or no longer available`），即使 catalog 列表里存在 — 属 DSH 运行时分层行为。`/cc-resume` 可优雅降级：直接运行 `scripts/cc-resume.mjs`（skill 本体只是 CLI 的包装说明）。

## [0.6.2] — 2026-08-18

### 变更
- **内置命令重命名**：`/plugin` → `/cc-plugin`，`/reload-plugins` → `/reload-cc-plugins`。通用名 `plugin` 易与 DSH 原生或第三方 skill 冲突；`cc-` 前缀明确标识 Claude Code 桥接命令。`/reload-skills` 保留为别名。

### 新增
- **`scripts/dsh-restart.sh`** — 可移植、安全的 DSH Web 重启脚本，含幂等 terminal-bash 提示词补丁：
  - 零硬编码用户路径：经 PATH、nvm 或 npx 缓存（`~/.npm/_npx/*/node_modules/.bin/dsh`）自动发现 `dsh`。
  - 补丁机器上**所有**已安装的 `dsh-terminal-bash` 副本。
  - 跨平台 `sed`（GNU/BSD）、SIGKILL 兜底、启动崩溃检测、`--no-patch` 模式、`DSH_RESTART_PORT` 覆盖。
  - 随 npm tarball（`files`）发布，bin 别名 `dsh-claude-compat-restart`。
- README：内置命令章节、`enablePluginManager`/`pluginManagerRank` 配置项、故障排查章节（中英双语）。

## [0.6.1] — 2026-08-18

### 新增
- **`/reload-cc-plugins`（原 `/reload-plugins`）与 `/reload-skills`** — catalog 热重载。加载 reload skill 定义即触发重载：`get()` 调用 provider control 的 `invalidate()`，递增 registry revision、清空 collect 缓存、广播 `skills/change`，Web GUI 技能选择器**在当前会话**内刷新 — 无需重启、无需新会话。插件自带的 MCP server 仍需进程重启。

## [0.6.0] — 2026-08-18

### 新增
- **`/cc-plugin`（原 `/plugin`）— 完整的 Claude Code 插件与 marketplace 管理**，作为用户可调用的 DSH skill：
  - 子命令对齐 `claude plugin`：`list`、`install <name>[@marketplace]`（支持一步式 `/cc-plugin name@market`）、`uninstall`、`enable`、`disable`、`update [name]`、`search <term>`、`marketplace list|add|remove|update`。
  - 执行引擎：**claude CLI 优先**（PATH 有 `claude` 时走 `claude plugin ...`），不可用时**自实现兜底**（直接操作 JSON + git）— 每个被修改的文件均生成带时间戳的备份。
  - 所有状态保存在 Claude 原生位置（`~/.claude/plugins/installed_plugins.json`、`known_marketplaces.json`、`~/.claude/settings.json` 的 `enabledPlugins`），Claude Code 与 DSH 读同一份真相；新装插件内容经现有发现桥接呈现。
  - 管理器封闭测试套件（`test/v060.test.js`）；对 `claude` 2.1.220 完成 install → disable → enable → uninstall 全生命周期实测。

## [0.5.1] — 2026-08-17

### 修复
- **插件返回非 Promise 对象导致 MCP 挂载崩溃**：真实 cordis 中 `ctx.plugin()` 返回 Fiber（PromiseLike），但测试/嵌入环境可能返回普通对象。`.catch` 调用改为 `typeof fiber.catch === 'function'` 守卫而非默认假定。同时升版本号以击穿 pnpm tarball 缓存（同名 `.tgz` 更新会保留过期完整性校验）。

## [0.5.0] — 2026-08-17

### 新增
- **插件 marketplace 支持**：读取 `~/.claude/plugins/installed_plugins.json`（v2 注册表），呈现每个已装插件的 skills、commands、agents — 以 manifest（`.claude-plugin/plugin.json`）驱动，无 manifest 插件回退目录扫描。内容落在 rank `750`（长尾层：项目 `.claude`、DSH 原生、`~/.claude` 在同名冲突时均优先）。
- **插件 MCP 挂载（可选）**：`enablePluginMcp: true` 时插件 manifest 中的 `mcpServers` 翻译为 `dsh-mcp-client` 实例；`${CLAUDE_PLUGIN_ROOT}` 替换为安装路径。

## [0.4.0] — 2026-08-16

### 新增
- **`.mcp.json` 挂载**：项目根的 MCP server 定义在 DSH 启动时翻译为 `dsh-mcp-client` 插件实例 — `command` → stdio，`url` → streamable-http。畸形条目或缺客户端包降级为警告，不崩溃。进程启动时从启动工作区读取一次；修改后需重启生效。
- **Claude Code hooks 子集**：`PreToolUse` → `tools/pre-execute`（exit 2 = 拒绝），`PostToolUse` → `tools/post-execute`（exit 2 = 阻断），`UserPromptSubmit` → `agent/pre-step`。匹配器支持精确名、`*` 通配、`|` 分隔多选；命令经 `/bin/sh -c` 执行，stdin 收 Claude 风格 JSON 载荷；支持 `hookSpecificOutput.permissionDecision` 覆盖；超时放行并告警。
- **`.claude/agents/*.md` 垫片**：DSH 无 markdown 子代理格式，每个 agent 文件转为 delegation 垫片 **skill**（模型与用户均可调用，`/agent-name` 可用）。frontmatter `name` 须为 kebab-case，否则用文件名；`description` 映射 `whenToUse`。同名 agent 与 skill 一样按 rank 去重。

## [0.3.0] — 2026-08-15

### 新增
- **用户级 `~/.claude/` 支持**：除项目外，同时拾取家目录下的 skills、commands、rules 及 `settings.json` hooks。去重优先级修正：**项目 `.claude`（rank 50）> DSH 原生（100–600）> `~/.claude`（700）**。与项目 rule 同名的用户 rule 跳过。

## [0.2.0] — 2026-08-14

### 新增
- **`dsh.bundle` 声明**一键激活：`dsh plugin --profile web add dsh-claude-compat` 自动激活插件 — 无需手编 `cordis.patch.yml`。

## [0.1.0] — 2026-08-13

### 新增
- 首个版本：将 Claude Code 的项目 `.claude/` 桥接进 DeepSeek Harness。
  - `skills/**/SKILL.md` → DSH skill provider（catalog 名称/描述，正文按需加载）。
  - `commands/*.md` → 用户可调用 skill（斜杠菜单里 `/command-name`）。
  - `rules/*.md` → 消息流注入：拼接后包 `<system-reminder>` 信封，每会话前置一次 — 与 Claude Code 同一通道（`prependUserContext`），模型遵循可靠。

[0.8.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.5.1...v0.6.2
[0.6.1]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/biedongbin/dsh-claude-compat/releases/tag/v0.1.0

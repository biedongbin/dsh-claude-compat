# 更新日志

[English](CHANGELOG.md) | 简体中文

本项目所有重要变更记录于此。版本遵循 [SemVer](https://semver.org/)。

## [Unreleased]

### 新增
- **支持 Claude Code 所有来源的 MCP 服务器。** 插件现在按 Claude Code 的优先级读取 `managed-mcp.json`（独占控制）、`managedMcpServers`，以及 `.claude.json` 中的本地与用户 `mcpServers`。还支持 `${VAR}` 展开、`timeout`、`headersHelper`、`disabledMcpjsonServers`、`disabledMcpServers`，以及 `allowedMcpServers` 与 `deniedMcpServers` 策略。损坏的 managed 文件或格式错误的 managed 策略会关闭服务器，每个被跳过的条目或策略项都会给出告警。README 列出了 DSH 无法运行的功能。
- **支持 Claude Code 的位置环境变量。** `CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_PLUGIN_CACHE_DIR`、`CLAUDE_CODE_PLUGIN_SEED_DIR`、`CLAUDE_CODE_PLUGIN_DIRS`、`CLAUDE_CODE_PROJECT_DIR_NAME` 现在会像在 Claude Code 中一样改变插件读取的路径。skills、rules、hooks、插件管理与 `/cc-resume` 共用 `src/lib.js` 中的同一组解析函数。
- **Hook 处理器字段。** 命令型 hook 支持 `args`（不经过 shell 直接执行）、`if`（权限规则，如 `Bash(git *)`，仅用于工具事件）、`timeout`（秒）、`async`（仅工具事件；不能改变决定）以及 `onFailure: "block"`。命令与参数中的 `${CLAUDE_PROJECT_DIR}` 会被展开，并设置到 hook 环境变量中。工具 hook 的 stdin 包含 `hook_event_name` 与 `cwd`。其他处理器类型（`http`、`prompt`、`agent`、`mcp_tool`）的条目会被跳过并给出警告。尚未支持的事件与处理器见 issue #2。
- **33 个 Claude Code hook 事件中的 26 个。** 除 PreToolUse、PostToolUse 和 UserPromptSubmit 外，插件现在还运行 SessionStart（挂在真正的启动点 `agent/created`）、SessionEnd、PostToolUseFailure、PermissionRequest、PermissionDenied、PostToolBatch、TaskCreated、TaskCompleted、Stop、StopFailure、SubagentStart、SubagentStop、Notification、MessageDisplay、UserPromptExpansion、CwdChanged、PreCompact、PostCompact、PostModelSwitch、TeammateIdle、InstructionsLoaded、FileChanged 与 ConfigChange。README 的 Hooks 一节列出了每个事件对应的 DSH 扩展点、无法运行的 7 个事件，以及所有能力比 Claude Code 弱的地方。hooks 也会从 `.claude/settings.local.json` 加载。
- **处理器类型 `http`、`mcp_tool`、`prompt` 与 `agent`。** `http` 以 JSON 提交输入，请求头只读取 `allowedEnvVars` 中列出的变量。`mcp_tool` 通过 DSH 工具服务调用 MCP 工具。`prompt` 向会话模型提一个问题。`agent` 启动 DSH 子 agent 并读取它的结构化回答。每种类型只在 Claude Code 允许的事件上运行。后台 hook 以退出码 2 结束时，`asyncRewake` 会引导 agent 继续。

### 修复
- **导入会话使用 DSH 原生项目目录 key**（[#12](https://github.com/biedongbin/dsh-claude-compat/issues/12)）。空格、非 ASCII 字符、连续分隔符、根目录与长路径现在对应到 DSH 实际读取的目录；CLI 回归覆盖列表、导入及已导入状态检测。
- **项目 `.mcp.json` 不能通过 `${VAR}` 读取凭据变量。** 仓库曾可以把 `${GITHUB_TOKEN}` 发送给它所指定的服务器。除非 `mcpTrustProjectConfig` 为 `true`，该变量保持字面文本，日志会指出它。helper 的清理现在也覆盖 `PASS`、`CRED`、`COOKIE`、`DSN` 与带密码的 URL。
- **`${CLAUDE_PLUGIN_ROOT}` 是变量值。** 安装路径中的 `${...}` 曾被再次展开，含 `$&` 的路径可能被当作模式。插件中名为 `__proto__` 的服务器曾被无声丢弃。现在重复的名称会被报告。
- **检查插件 MCP 文件。** `mcpServers` 中的路径必须位于插件内。损坏的链接、无法读取的文件、错误的包装与无效的 JSON 都会连同原因一起报告。没有 `plugin.json` 的插件仍会加载其根目录的 `.mcp.json`。
- **managed 的 `disabledMcpjsonServers` 不是列表时，所有 MCP 服务器保持关闭。** 被禁用与被隐藏的条目现在会记录名称与来源。单个条目抛出异常不再中断其他条目，插件步骤失败也不再隐藏告警或用户的服务器。
- **插件管理器遇到内容为 `null`、列表或错误 `plugins` 值的 JSON 文件时不再抛出异常。**
- **超过 Node 定时器上限的 `timeout` 会被截断。** 失败的 `headersHelper` 会给出退出状态与 stderr 首行，而不是命令行。
- **项目 `headersHelper` 不带凭据变量运行，且仅在受信任时运行。** 项目 `.mcp.json` 的 helper 仅在 `mcpTrustProjectConfig` 为 `true` 时运行，且拿不到 `*_TOKEN`、`*_KEY`、`ANTHROPIC_CUSTOM_HEADERS` 等变量，服务器 URL 中这些变量的值会被隐藏。该选项关闭时，服务器只带静态 headers 挂载。用户、本地与 managed 来源的 helper 保留用户环境。
- **校验 `managedMcpServers` 条目。** 条目必须是固定的 `https://` 服务器，不能有 `command`、`args`、`env`、`headersHelper` 或 `${VAR}`。不合格的条目会被跳过，也不再跳过 allowlist。`managed-mcp.json` 不受此规则限制。
- **单个格式错误的 MCP 条目不再中断加载。** 类似 `"bad": null` 的条目会被跳过并给出告警，其他服务器仍会加载。
- **matcher 遵循 Claude Code 的规则。** 只含字母、数字、`_`、`-`、空格、`,` 和 `|` 的 matcher 是精确名列表，其他 matcher 是不锚定的正则表达式，因此 `.*opus.*` 与 `mcp__memory__.*` 现在和 Claude Code 一样能匹配。无法解析的正则会在 hook 加载时报告一次。
  不属于 `.*` 的 `*` 仍像早期版本一样当作通配符，因此 `mcp__*__delete` 这类守卫继续有效。
  Stop、UserPromptSubmit 等没有 subject 的事件和 Claude Code 一样忽略 matcher。
- **hook 不能批准它本想修改的输入。** 返回 `updatedInput` 的 PreToolUse hook 现在会让 DSH 询问用户；带 `updatedInput` 的 PermissionRequest `allow` 被忽略，因为 DSH 无法修改工具输入，而原输入正是 hook 想去掉的内容。
- **丢失的 hook 取值会写入日志。** 日志现在会指出使用了未列出或未设置变量的 HTTP 头、没有匹配任何字段的 `mcp_tool` 占位符、无法读取或超出大小上限的规则文件，以及 DSH 无法执行的 PreToolUse `allow` 或 PostToolUse 停止请求。
- **验证子代理受到限制。** `agent` hook 子代理的停止不再占住 DSH 事件，它启动的子代理也会被静音。hook 输出按完整字符截断，空白的 command、server、tool 或 prompt 会被拒绝。
- **SessionStart hooks 从未运行。** 插件监听的 `agent/session-start` 在 DSH 中不存在。现在改用 `agent/created`，并按启动来源（`startup`、`resume`、`clear`、`compact`）过滤。
- **工具 hooks 把工具调用 id 当作 `session_id` 发送。** 输入现在携带 DSH 会话 id；在子 agent 内携带主会话 id，并附带 `agent_id` 与 `agent_type`。
- **会话与回合 hooks 会对子 agent 会话运行，规则或 hook 上下文被当作用户提示。** SessionStart、SessionEnd、UserPromptSubmit、Stop 等主会话 hooks 现在会跳过子 agent 会话。本插件自己注入的消息不再触发 UserPromptSubmit hooks。

### 变更
- 项目之外也会加载 MCP 服务器，因为 `.claude.json` 与 managed 文件对所有目录生效。与 Claude Code 一致，只有 `url` 而无 `type` 的条目会被跳过。`sse` 与 `ws` 条目被跳过并给出告警。
- `CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_PLUGIN_CACHE_DIR`、`CLAUDE_CODE_PLUGIN_SEED_DIR` 为相对路径时，插件不再激活，并输出一行指明变量名的错误。启动时只检查有效配置实际用到的变量，因此显式配置的 `userClaudeDir` 或 `pluginsRoot` 会覆盖其对应变量，被覆盖的变量取值错误不会报错。
- `CLAUDE_CODE_PLUGIN_DIRS` 接受绝对路径和以 `~` 开头的条目，其他条目会被跳过并给出警告，与 Claude Code 一致。
- `CLAUDE_CODE_PLUGIN_DIRS` 中的插件会整体替换同一清单名称的已安装插件。每次替换会输出一条警告。
- 插件现在会对以下情况输出警告：无法读取的 `plugin.json`、缺少 `plugins` 对象的 `installed_plugins.json`、缺失的种子插件。种子记录不能再让缓存查找跳出 `<seed>/cache`。
- `/cc-resume` 的 list 与 import 现在读取配置的 `userClaudeDir`，与 skill 目录一致。`--user-claude-dir` 参数把它传给脚本。
- `enablePlugins` 为 `false` 时，相对路径的 `CLAUDE_CODE_PLUGIN_SEED_DIR` 不再阻止激活。
- 挂载路径与构建路径不同的插件种子现在可以加载：插件文件从当前种子根目录读取。
- `CLAUDE_CODE_PROJECT_DIR_NAME` 仅在同时设置 `CLAUDE_CONFIG_DIR` 时生效，且只接受 1 到 64 个字母、数字、连字符或下划线（不能是 Windows 设备名）。其他值会被忽略，不会报错。
- `/cc-plugin` 与插件目录现在遵循配置项 `userClaudeDir` 和 `pluginsRoot`。
- `userClaudeDir` 与 `pluginsRoot` 不再有默认值。未设置时依次使用对应环境变量、`~/.claude`。显式配置值优先。

### 修复
- Hook 的 matcher、`if` 规则和 hook 输入负载现在使用 Claude Code 对 DSH 内置工具的名称（`bash` 即 `Bash`，`read`、`edit`、`write` 同理）。此前 `if: "Bash(git *)"` 永远匹配不到原生调用。
- Hook 的 stdout 与 stderr 在多字节字符被拆成两个数据块时保持字符完整。
- `/cc-resume` 现在按 Claude Code 的方式推导 Claude 项目文件夹名：所有非字母、数字的字符都变为 `-`，超过 200 个字符的名称会被截断并附加路径哈希。工作目录含有 `.`、`_` 或空格时，不再对应到不存在的文件夹。Issue #11。

## [1.0.1] — 2026-11-04

### 修复
- **项目不是 git 仓库时，项目级 `.claude/skills` 与 `.claude/rules` 被静默跳过**（[#10](https://github.com/biedongbin/dsh-claude-compat/issues/10)）。`findProjectRoot`/`findProjectRootSync` 逐级走到文件系统根，未找到 `.git` 便返回 `undefined`；两处调用点（skills 的 `list()`、rules 的 `buildRulesText()`）都以 `undefined` 为条件直接跳过，且无任何日志。现改为：祖先链上没有任何 `projectRootMarkers` 标记时，回退到会话 cwd 作为项目根——与 DSH `dsh-skill-filesystem` 的根规则一致（"nearest ancestor containing `.git`; without one, the current cwd is used"），也与 Claude Code 在任何目录都读取 `.claude/` 的行为对齐。同一回退同时覆盖项目 hooks（`loadHookSettings`）与项目 `.mcp.json`。由 `test/v100.test.js` 覆盖。

## [1.0.0] — 2026-10-30

### 新增
- **发布至 DSH 插件市场。** 仓库现托管市场索引 `site/index.json`，由 `.github/workflows/market.yml` 部署到 GitHub Pages。在 DSH 插件市场的「发现」标签页添加索引源 `https://biedongbin.github.io/dsh-claude-compat/index.json`，即可浏览并安装全部版本。`scripts/update-market-index.mjs` 从 npm registry 再生索引（规则与官方生成器一致：未弃用且声明 `dsh.bundle` 的版本）；已列出的版本跨重跑保留，`npm publish` 后重跑并提交即可收录新版。0.9.2 曾打包但从未推送 npm——registry 从 0.9.1 直接跳到 1.0.0。

## [0.9.2] — 2026-10-28

### 新增
- **管理面升级为 DSH 原生 slash 命令**（`/cc-resume`、`/cc-plugin`、`/cc-export`、`/reload-cc-plugins`、`/reload-skills`）。DSH 的 `@deepseek-ai/dsh-commands` 服务（随官方 Web 宿主内置）允许插件注册**宿主直接执行**的人类命令：用户提交 slash 行后 handler 在 DSH 进程内运行，结果文本由 UI 直接渲染——命令的发现、执行与输出**不消耗任何模型 token**、绝不进入模型历史（每次运行以 log-only 的 `command/run`+`command/done` 事件对记入会话日志）。handler 直接 spawn 本包 CLI（`scripts/cc-resume.mjs`、`scripts/cc-export.mjs`），并以 `--cwd` 钉死**会话**工作目录（宿主进程 cwd 不是工作区）；`/cc-plugin` 复用 `runPluginCommand`；reload 命令直接调 skill registry 的 `control.invalidate()`。注册走运行时守卫 `ctx.inject(['commands'], …)`——与官方内置 `dsh-plan-mode` 完全同款——无该服务的宿主（UI-less spine、ACP 自动化、旧版本）静默回落到 skill 路径。回归由 `test/v092.test.js` 覆盖。

### 变更
- **五个管理技能退出用户 slash 菜单**（`userInvocable: false`，保持 `modelInvocable: true`）：人类入口收敛为原生命令，菜单里每个功能只剩一条（不再命令 + 模型中介技能并列）；模型仍保留可加载的说明书作为回落面。

## [0.9.1] — 2026-10-28

### 修复
- **管理技能目录可见但永远加载失败（`skill "cc-plugin" is unknown or no longer available`）** —— 波及全部五个 inline 技能（`/cc-plugin`、`/reload-cc-plugins`、`/reload-skills`、`/cc-resume`、`/cc-export`）。DSH registry 加载定义的唯一通道是 `provider.get(candidate)`，candidate 自带的 `get()` 闭包永远不会被调用；这五个技能的 body 恰恰埋在这种闭包里，locator 又存着 `import.meta.url`（`file://` URL），`provider.get()` 照着它读盘 —— `readTextSafe(file://…)` 返回 `undefined`，registry 于是报技能不存在。闭包还带着两处连带缺陷：返回 `{ body }` 而 `validateDefinition` 要求 `{ content }`；`/reload-cc-plugins` 的缓存刷新（`control.invalidate()`）也埋在闭包里，reload 从未真正刷新过。现在 body 与 invalidate 标志随 locator 传递（`{ kind: 'inline', body, invalidate }`），`provider.get()` 对 inline 候选直接返回定义、在加载时触发 `invalidate()` —— 加载 reload 技能即完成刷新。同时了结 0.7.0 的「已知问题」：根因是本插件的死闭包，并非 DSH 运行时分层。回归由 `test/v060.test.js` 与 `test/self-check.test.js`（真 `SkillRegistry` 加载断言）覆盖。
- **`/cc-plugin` HELP 文案通篇写 `/plugin`**，与实际技能名 `/cc-plugin` 不一致；已统一，且 Execution 段明确指示模型经 bash 运行 `claude plugin <args>`（`runPluginCommand` 没有 DSH tool 挂载，skill body 是唯一执行通路）。

### 工具
- **npm 包只发布运行时脚本**。`files` 此前整目录收录 `scripts/`，把仅维护者使用的工具（`deploy-local.sh` —— checkout→profile 部署，错误提示硬编码 macOS app 路径，别处无意义；`gen-downloads-chart.mjs`）一并带了出去。现改为逐个列举安装后真正需要的四个：`cc-resume.mjs`、`cc-export.mjs`、`zstd-compat.mjs`、`dsh-restart.sh`（`bin` 用）。两个开发脚本仍留在仓库，仅瘦身发布包。

## [0.9.0] — 2026-10-28

### 新增
- **`skillAliases`：让中文（及任何非 ASCII）技能名可用**。DSH 的技能名文法固定为 kebab-case（`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，定义在 `@deepseek-ai/dsh-skill`，registry 在 `get()` 取用前先校验），中文名在插件层放行也没用 —— 下一层必然 `return void 0`，所以此前只能整条丢弃。现在可以显式映射成合法 slug：`skillAliases: { "三脑": "san-nao" }`，原名保留在描述最前（`三脑 — …`，可用 `aliasDescriptionPrefix: false` 关掉）。映射同时作用于 skills / commands / agents / 插件技能。合法名永远压过映射，别名沿用原 provider 的 rank，与 DSH 原生或 `~/.agents` 同名时按原有优先级去重。回归由 `test/v090.test.js` 覆盖。

### 修复
- **非 kebab 名技能被静默丢弃**：`skills`、`commands`、`agents`、插件命令四处都是裸 `continue`，用户只能靠翻源码才知道哪个技能没进来。现在每个文件每进程告警一次，并直接给出可粘贴的 `skillAliases` 示例。

### 工具
- **`scripts/deploy-local.sh`**：把本仓库 `src/` 同步进已安装的 DSH profile（`~/.dsh/profiles/<profile>/node_modules/dsh-claude-compat`），并留一份带时间戳的备份。DSH 在进程启动时 import 的是安装副本，直接改 checkout 不生效。（`bash scripts/deploy-local.sh --help`。）由 PR #3 贡献。

_贡献者 @liujunctz123-jpg（PR #3）。_

## [0.8.4] — 2026-10-18

### 修复
- **dsh 0.2.0 下新会话无法加载（`format v4 message requires a producer-owned source kind`）**：会话格式 v4 准入（`session-format-v3-to-v4/src/message-sources.ts`）拒绝退役的 V3 包装 `source.kind: 'plugin'` —— 第三方生产者须声明自有 kind。三处注入点（`index.js` 的 rules、`hooks.js` 的两处 hook-context）仍在发旧包装，故凡含 `.claude/rules/*.md` 的项目，新会话在加载阶段即被拒。现改发 `source.kind: 'plugin:dsh-claude-compat'` 并删去 `plugin` 字段 —— 此值正是 dsh 自身 `producerKind()` 为我们推导的结果（不在 `RENAMED_PRODUCERS`/`RELEASED_SAME_NAME_PRODUCERS` 中 → `plugin:${plugin}`），故 0.8.3 写下的、经 dsh 迁移的旧日志与今日新写的消息收敛于同一值。判重逻辑改为比对共享常量 `CLAUDE_COMPAT_SOURCE_KIND`。回归由 `test/v080.test.js` 覆盖，并对真实准入谓词验证于 `test-evidence/verify-084-v4-admission.mjs`。对应 Issue #2。

## [0.8.3] — 2026-09-30

### 修复
- **rules 判重扫描用错了事件查询 API**：pre-step 钩子取一次 `snapshotEvents()` 快照后按 surface 的 seq 索引（`events[seq]`）。快照数组下标与会话 seq 并不保证对齐（dsh 有 `firstLiveSeq`/偏移语义），防重复注入检查可能静默落空。现改用 `session.eventAt(seq)` — dsh 核心自身做 surface 扫描所用的精确查询 API — 并保留 `session.events?.[seq]` 回退以兼容 0.1.2 之前宿主。基于 @SvenKunkka 的 PR #1。

## [0.8.2] — 2026-09-30

### 修复
- **dsh 升级后会话档案无法加载（`cannot safely transform unclassified message source`）**：插件注入的消息携带自定义 `source.kind: 'claude-compat'`，不在 dsh 迁移器白名单（`SOURCE_KINDS`）内，凡含此类消息的会话日志在 v0→v3 迁移时 fail-closed 拒载。注入来源（`index.js` 的 rules、`hooks.js` 的 hook-context）改为白名单内的 `kind: 'plugin'` + `plugin: 'dsh-claude-compat'` — 与 dsh 核心插件（`@deepseek-ai/dsh-system-prompt`、`user-approval`）已写入的形态一致。防重复注入的回读检测同步改为匹配新标识。

## [0.8.1] — 2026-09-08

### 修复
- **resume 崩溃（`Cannot read properties of undefined (reading '7')`）**：rules 的 `agent/pre-step` 钩子索引 `agent.session.events[seq]`，但 dsh 0.1.2-rc.1 的 `Session` 没有 `events` 属性 — 公开 API 是 `snapshotEvents()`。resume 时 surface 非空，`.some()` 回调首次执行即抛，本轮以 `code UNKNOWN` 失败。钩子改为循环外取一次 `snapshotEvents()` 快照再索引。新会话不受影响（空 surface 短路）。

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
- `skill` 工具在 agent scoped 运行层可能无法解析插件提供的 skill（报 `unknown or no longer available`），即使 catalog 列表里存在 — 属 DSH 运行时分层行为。`/cc-resume` 可优雅降级：直接运行 `scripts/cc-resume.mjs`（skill 本体只是 CLI 的包装说明）。**0.9.1 已解决 —— 根因是本插件永不被调用的 inline 闭包，并非 DSH。**

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

[0.8.1]: https://github.com/biedongbin/dsh-claude-compat/compare/v0.8.0...v0.8.1
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

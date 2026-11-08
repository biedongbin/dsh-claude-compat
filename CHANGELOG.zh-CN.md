# 更新日志

[English](CHANGELOG.md) | 简体中文

本项目所有重要变更记录于此。版本遵循 [SemVer](https://semver.org/)。

## [1.2.1] — 2026-11-08

### 修复
- **Cordis 服务读取**（[#14](https://github.com/biedongbin/dsh-claude-compat/issues/14)、[#13](https://github.com/biedongbin/dsh-claude-compat/pull/13)）。通过 `ctx.get()` 读取可选的工作目录、会话持久化、工具、模型及子代理服务。构造 Hook 输入不再因 `cannot get property "workingDirectory" without inject` 中断；工作目录服务缺失时仍回退到会话目录。
- **两个受支持 DSH 版本的工具执行。** 执行前选择接口：`0.2.2-rc.1` 使用 wire-call 批次，`0.2.1-rc.2` 使用单次调用并接收解码后的 JSON 参数。保留调用 ID、Agent scope 和取消信号，异常或错误结果均不会触发工具重试。
- **预发布版本声明。** Engine 与 peer 范围明确包含 `0.2.1-rc.2`、`0.2.2-rc.1`，修正原范围意外排除较新候选版本的问题。

### 兼容维护策略
- 每次仅维护两个明确验证的 DSH 版本。本次支持 `0.2.1-rc.2` 和 `0.2.2-rc.1`；后续升级滚动更新支持列表，不无限保留旧版兼容。
- 更新后重启 DSH，使修正后的 Hook 监听器生效。

### 验证
- 扩充 JSON 参数解码、结果 ID 匹配、scope 与信号保留、非法参数、未知执行器以及失败和取消不重试的回归测试。
- Node 24.22.2 全量检查：787 通过、0 失败、2 项可选 testkit 跳过。Node 22 仍保留此前已知的 URL 归一化属性测试差异。
- 两个独立安装且依赖版本一致的 DSH 工具运行时共通过 18 项集成验证，覆盖真实 Cordis Hook 的允许／拒绝／失败路径及取消。这些验证覆盖工具与 Hook 集成，不等同于完整 GUI 或真实模型／网络部署验证。

## [1.2.0] — 2026-11-06

### 升级须知
- **要求 DSH `>=0.2.2-rc.1 <0.3.0`。** 更新后重启 DSH；包管理器报告包路径变化时，需要完整退出再打开。
- **一键恢复改为发送文件引用。** DSH 只收到源 Claude JSONL 路径和简短指令，按需读取后概述背景、当前任务状态和下一步计划，不再把历史正文粘贴进提示。
- **插件写操作依赖 Claude CLI，范围为用户级。** CLI 失败会明确返回失败，不再通过直接修改注册表或 Git 目录兜底。种子与内联来源会显示实际支持的只读能力。

### 新增
- **原生 Claude Code 管理界面。** Claude Code 标签页与交互命令卡片覆盖已安装插件、发现插件、市场、历史会话和桥接状态，提供中英文文案及主题适配控件。
- **逐项异步操作。** 可连续提交多个条目更新，分别查看排队、执行和结果并独立取消；共用配置与缓存的写操作保留规范路径锁，活动任务和结果历史均有上限。
- **可选分页与新增入口。** 默认每页 10 条，可选 10/20/50/100；更新其他条目时仍可添加插件市场或安装新插件。
- **行内会话预览与两种恢复目标。** 管理页在源项目工作区新建普通 DSH 会话；从某个 DSH 对话内的 `/cc-resume` 卡片点击时，直接向当前会话发送阅读请求，保留已有消息、目录和模型。最近若干轮选项用于提示 DSH 的阅读重点。
- **结构化 `claude_compat` 工具。** 原生界面、命令与模型工具共用操作结果和错误，支持历史定位、文件引用交接、插件管理和目录刷新。

### 修复
- **空白会话首条命令不可见。** 即使 DSH 尚未显示普通聊天视图，输入框上方也会显示管理命令结果；五个命令的加载、成功与错误均可见，正常聊天激活后移除备用区域，避免重复显示。
- **桌面版传输路由。** 精确的认证 Fetch 路由与原生 Gateway 共存，保留所有者、Origin 和生命周期检查。
- **大历史与源目录变化。** 恢复准备仅安全定位源文件并有界采样元数据，不再扫描或组装全文。Claude 会话中途切换 cwd 不再阻止预览或文件引用交接。
- **恢复目标与提交回执。** 分开处理 Claude 来源身份和 DSH 目标会话；稳定请求 ID 避免重复创建或提交，部分失败保留已知目标，已确认接收不误报为取消，较早完成的任务不会抢走后续导航。
- **导出进程与参数。** 桌面版解析真正的 Node 解释器，使用会话实际 cwd，一致处理相对目标；末尾 `--overwrite` 正常生效，非法参数与写入失败返回错误。
- **刷新与 Hook 接口。** 两个 reload 命令及 inline 技能等待实际失效刷新并报告失败；MCP Hook 使用当前原生批量工具接口；旧式归档重试保留已有 DSH 接续内容。

### 验证
- 新增原生空会话门控、纯命令生命周期更新、逐项队列、有界文件引用、当前／新建会话目标、认证 HTTP 传输、真实临时项目导出和刷新失败回归。

## [1.1.0] — 2026-11-05

### 升级须知
- **HTTP MCP 条目必须写 `"type": "http"`**（或 `"streamable-http"`）。只有 URL 而没有类型，以及不支持的 `sse`/`ws` 传输，均会告警并跳过；升级前请调整远程服务器配置。
- **项目 MCP 凭据与 helper 需要显式信任。** `mcpTrustProjectConfig` 默认为 `false`：不运行项目 `headersHelper`，凭据类 `${VAR}` 保持字面文本。仅对可信项目开启；开启后项目 helper 的继承环境仍会清理凭据。
- **更新后重启 DSH。** MCP 与项目 hooks 在启动时从启动工作区加载；本版本不包含按会话发现 MCP 或 native-realm 集成。
- **旧导入在 DSH 中找不到时，请重新导入原 Claude 会话。** 新导入使用修正后的 DSH 目录 key；不会自动移动或删除旧目录中的日志。

### 新增
- **Claude Code 位置配置**（[#6](https://github.com/biedongbin/dsh-claude-compat/pull/6)）：支持 `CLAUDE_CONFIG_DIR`、插件缓存／种子／内联目录与 `CLAUDE_CODE_PROJECT_DIR_NAME`，显式配置优先；支持种子搬移和内联插件整体覆盖。
- **Hook 处理器字段与生命周期覆盖**（[#7](https://github.com/biedongbin/dsh-claude-compat/pull/7)、[#8](https://github.com/biedongbin/dsh-claude-compat/pull/8)）：桥接 33 个事件中的 26 个，支持 `command`、`http`、`mcp_tool`、`prompt`、`agent` 五类处理器、条件执行、单 hook 超时、异步运行、失败拦截与 `asyncRewake`。各事件限制及不支持项见 README。
- **更多 MCP 来源与策略**（[#9](https://github.com/biedongbin/dsh-claude-compat/pull/9)）：读取 managed、本地、项目、用户及显式启用的插件定义；处理来源优先级、禁用名单、允许／拒绝策略、环境变量、调用超时和挂载时的 `headersHelper`。managed 策略无效时关闭服务器。

### 修复
- **标点、空格、非 ASCII 与长路径下的 Claude 会话发现**（[#11](https://github.com/biedongbin/dsh-claude-compat/issues/11)）。复用现有 Claude 目录编码及完整路径哈希，显式 list/import 命令保留自定义 Claude 配置根目录。
- **DSH 会话导入目录**（[#12](https://github.com/biedongbin/dsh-claude-compat/issues/12)）。导入与已导入状态检测共用 DSH 原生 key：折叠分隔符、按 UTF-16 码元作 `~XXXX` 转义、处理根目录并将 slug 限制为 251 字符。真实 CLI 回归同时检查源会话发现与生成的压缩日志位置。
- **Hook 运行时接口。** 使用原生工具名、单次 MCP 执行协议及调用 Agent 的 scope；在 `agent/request` 观察模型切换；未配置 CwdChanged hook 时也更新文件监视目录；保留 PermissionRequest 的失败拦截结果。
- **Hook 输出与生命周期。** 正确解码跨块 UTF-8、限制输出与验证子代理清理时间、保留验证子代理后代的守卫，并报告被忽略或无效的输出。SessionStart 改用 `agent/created`，负载传递会话 id，注入上下文不再触发用户提示 hook。
- **MCP 来源隔离与诊断。** 逐条跳过畸形条目，在策略豁免前校验 managed 定义，限制插件文件引用，避免插件根目录二次展开，并清理项目 helper 凭据。插件管理器的畸形 JSON 与过大超时也有明确处理。

### 验证与剩余限制
- 发布验证使用 DSH 0.2.1-rc.5 与 Desktop 自带 Node 24.21.0。Node 22 的 URL 归一化属性测试存在已知差异，不能视为该运行时已完整验证。
- 自定义 `userClaudeDir` 时，请使用显式 `/cc-resume list` 与 `/cc-resume import <id>`。默认交互选择器后续的 skill 交接尚未携带该目录。
- 完整 AgentLoop 契约测试需要匹配的可选 testkit；1.1.0 的隔离验证为 628 通过、0 失败、2 项能力跳过。

## [1.0.1] — 2026-11-04

### 修复
- **项目不是 git 仓库时，项目级 `.claude/skills` 与 `.claude/rules` 被静默跳过**（[#10](https://github.com/biedongbin/dsh-claude-compat/issues/10)）。`findProjectRoot`/`findProjectRootSync` 逐级走到文件系统根，未找到 `.git` 便返回 `undefined`；两处调用点（skills 的 `list()`、rules 的 `buildRulesText()`）都以 `undefined` 为条件直接跳过，且无任何日志。现改为：祖先链上没有任何 `projectRootMarkers` 标记时，回退到会话 cwd 作为项目根——与 DSH `dsh-skill-filesystem` 的根规则一致（"nearest ancestor containing `.git`; without one, the current cwd is used"），也与 Claude Code 在任何目录都读取 `.claude/` 的行为对齐。同一回退同时覆盖项目 hooks（`loadHookSettings`）与项目 `.mcp.json`。由 `test/v100.test.js` 覆盖。

## [1.0.0] — 2026-10-30

### 新增
- **发布至 DSH 插件市场。** 仓库现托管市场索引 `site/index.json`，由 `.github/workflows/market.yml` 部署到 GitHub Pages。在 DSH 插件市场的「发现」标签页添加索引源 `https://biedongbin.github.io/dsh-claude-compat/index.json`，即可浏览并安装全部版本。`scripts/update-market-index.mjs` 从 npm registry 再生索引（规则与官方生成器一致：未弃用且声明 `dsh.bundle` 的版本）；已列出的版本跨重跑保留，`npm publish` 后重跑并提交即可收录新版。

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
- **npm 包只发布运行时脚本**。`files` 此前整目录收录 `scripts/`，把开发工具（`deploy-local.sh` —— checkout→profile 部署，错误提示硬编码 macOS app 路径，别处无意义；`gen-downloads-chart.mjs`）一并带了出去。现改为逐个列举安装后真正需要的四个：`cc-resume.mjs`、`cc-export.mjs`、`zstd-compat.mjs`、`dsh-restart.sh`（`bin` 用）。两个开发脚本仍留在仓库，仅瘦身发布包。

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

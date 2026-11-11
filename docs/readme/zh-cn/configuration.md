[← 项目首页](../../../README.zh-CN.md) · [English](../en/configuration.md)

# 配置

| 选项 | 默认值 | 说明 |
|---|---|---|
| `enableSkills` | `true` | 注册 `.claude/skills` + `.claude/commands` + `.claude/agents` provider（项目与 `~/.claude` 均含） |
| `enableRules` | `true` | 注入项目 + `~/.claude` 的 `rules/*.md` 到消息流 |
| `enableMcp` | `true` | 将 managed、本地、项目与用户 MCP 定义挂载为原生 MCP 客户端插件；插件定义另需 `enablePluginMcp` |
| `mcpTrustProjectConfig` | `false` | 信任项目 `.mcp.json`：其 `headersHelper` 会运行（不带用户的凭据变量），其 `${VAR}` 可读取凭据变量。关闭时服务器只带静态 headers 与字面文本挂载 |
| `mcpFailOnStartupError` | `false` | 转发给 `dsh-mcp-client`：MCP 服务器连接失败时让插件启动失败 |
| `enableHooks` | `true` | 运行 `.claude/settings.json` 文件中的 hooks（见 [Hooks](hooks.md#hooks)） |
| `hooksTimeoutMs` | `60000` | 每个 hook 的默认运行超时，单位毫秒，取值 1 至 2147483647。hook 自身的 `timeout`（单位秒）优先生效。与 Claude Code 一致，SessionEnd 默认 1.5 秒，UserPromptSubmit 与 PostModelSwitch 默认 30 秒，MessageDisplay 默认 10 秒；prompt hook 默认 30 秒，agent hook 默认 60 秒 |
| `enableAgents` | `true` | 把 `.claude/agents/*.md` 暴露为委派 shim skill |
| `skillAliases` | `{}` | 非 kebab 名（中文等）→ ASCII slug 的映射，如 `{ "三脑": "san-nao" }`。见[中文 / 非 ASCII 技能名](bridge-behavior.md#中文--非-ascii-技能名) |
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

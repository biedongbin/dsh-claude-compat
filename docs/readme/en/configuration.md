[← Project overview](../../../README.md) · [简体中文](../zh-cn/configuration.md)

# Configuration

| Option | Default | Description |
|---|---|---|
| `enableSkills` | `true` | Register the `.claude/skills` + `.claude/commands` + `.claude/agents` provider (project and `~/.claude`) |
| `enableRules` | `true` | Inject project + `~/.claude` `rules/*.md` into the message stream |
| `enableMcp` | `true` | Load managed, local, project and user MCP definitions into native MCP client plugins; plugin definitions additionally require `enablePluginMcp` |
| `mcpTrustProjectConfig` | `false` | Trust the project `.mcp.json`: its `headersHelper` runs (without the credential variables of the user), and its `${VAR}` may read credential variables. Off means the server mounts with its static headers and the literal text |
| `mcpFailOnStartupError` | `false` | Forward to `dsh-mcp-client`: fail plugin startup when an MCP server fails to connect |
| `enableHooks` | `true` | Run hooks from the `.claude/settings.json` files (see [Hooks](hooks.md#hooks)) |
| `hooksTimeoutMs` | `60000` | Default per-hook run timeout in ms, 1 to 2147483647. A handler's own `timeout`, in seconds, overrides it. Like Claude Code, the default is 1.5 s for SessionEnd, 30 s for UserPromptSubmit and PostModelSwitch, and 10 s for MessageDisplay. prompt hooks default to 30 s and agent hooks to 60 s |
| `enableAgents` | `true` | Surface `.claude/agents/*.md` as delegation-shim skills |
| `skillAliases` | `{}` | Non-kebab (e.g. Chinese) name → ASCII slug map, e.g. `{ "三脑": "san-nao" }`. See [Non-ASCII skill names](bridge-behavior.md#non-ascii-skill-names) |
| `aliasDescriptionPrefix` | `true` | When an alias is used, put the original name in front of the description: `san-nao: 三脑 — …` |
| `rulesMaxBytes` | `65536` | Hard cap on total injected project rules text |
| `userRulesMaxBytes` | `65536` | Hard cap on total injected `~/.claude/rules` text |
| `projectRootMarkers` | `[".git"]` | Ancestor markers for project-root discovery; with no marker anywhere, the session cwd itself is the project root |
| `skillRank` | `50` | Provider rank for project `.claude` skills (wins every DSH-native collision) |
| `skillSource` | `project-claude` | Source tag for project catalog entries |
| `userSkillRank` | `700` | Provider rank for `~/.claude` skills (loses to DSH-native `600`) |
| `userSkillSource` | `user-claude` | Source tag for `~/.claude` catalog entries |
| `userClaudeDir` | unset | User-level `.claude` directory (`~` expands to the home dir). Unset means `CLAUDE_CONFIG_DIR`, then `~/.claude` |
| `enablePlugins` | `true` | Surface skills/commands/agents from installed Claude Code plugins (`~/.claude/plugins`) |
| `pluginSkillRank` | `750` | Provider rank for plugin content (the long tail — everything else wins) |
| `pluginSkillSource` | `claude-plugin` | Source tag for plugin catalog entries |
| `pluginsRoot` | unset | Plugin-marketplace root (`installed_plugins.json` + `cache/`). Unset means `CLAUDE_CODE_PLUGIN_CACHE_DIR`, then `<user dir>/plugins` |
| `enablePluginMcp` | `false` | Mount plugin-declared MCP servers (opt-in; requires `enablePlugins` and `enableMcp`). This covers every plugin the plugin catalog reads, including plugins from `CLAUDE_CODE_PLUGIN_SEED_DIR` and `CLAUDE_CODE_PLUGIN_DIRS` |
| `enablePluginManager` | `true` | Register the `/cc-plugin`, `/reload-cc-plugins`, `/reload-skills` management skills |
| `pluginManagerRank` | `40` | Rank for the built-in management skills (top of the catalog) |

### Claude Code environment variables

The plugin reads the same variables Claude Code uses to move its default locations.
An explicit config key above wins over a variable.
A variable wins over the `~/.claude` default.
`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, and `CLAUDE_CODE_PLUGIN_SEED_DIR` must hold absolute paths.
A relative value keeps the plugin from activating, and one error line names the variable.
The plugin checks only the variables that it uses: an explicit `userClaudeDir` or `pluginsRoot` value hides a bad variable behind it.
A relative value in a config key still resolves against the launch directory.

| Variable | Effect |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Replaces `~/.claude`: settings, rules, skills, commands, agents, and session history |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR` | Replaces the plugins root (`~/.claude/plugins`) |
| `CLAUDE_CODE_PLUGIN_SEED_DIR` | Extra read-only plugins roots, separated by `:` on Unix and `;` on Windows. The primary root wins a name collision. Plugin files are read from the current seed path, so a seed can be mounted at another path |
| `CLAUDE_CODE_PLUGIN_DIRS` | Plugin directories loaded for the session, same separators. Each entry is an absolute path or starts with `~`. Other entries and entries that are not directories are skipped with a warning. A plugin here replaces an installed plugin with the same manifest name |
| `CLAUDE_CODE_PROJECT_DIR_NAME` | One folder name under `projects/` that `/cc-resume` reads, in place of the name derived from the working directory. It applies only when `CLAUDE_CONFIG_DIR` is also set, and only for 1 to 64 letters, digits, hyphens, or underscores. Claude Code ignores any other value, and so does the plugin |

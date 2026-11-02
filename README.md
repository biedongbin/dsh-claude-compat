<p align="center">
  <img src="https://img.shields.io/badge/dsh-plugin-blue?style=for-the-badge" alt="DSH Plugin">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/🌐_简体中文-点我阅读中文-red?style=for-the-badge" alt="简体中文"></a>
  <img src="https://img.shields.io/npm/dm/dsh-claude-compat?style=flat-square&label=downloads/month&color=brightgreen" alt="npm downloads/month">
  <img src="https://img.shields.io/npm/dt/dsh-claude-compat?style=flat-square&label=total%20downloads&color=blue" alt="npm total downloads">
  <img src="https://img.shields.io/npm/v/dsh-claude-compat?style=flat-square&label=version&color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

> **Reuse your entire Claude Code setup in DSH — zero migration.**
> skills, commands, rules, agents, hooks, MCP — install and they just work. Nothing to reconfigure.

---

## The 10-second pitch

You've already built up a solid `.claude/` in Claude Code — skills, slash commands, rules, agents, hooks, MCP servers. Moving to **DSH (DeepSeek Harness)** shouldn't mean rebuilding all of it.

**dsh-claude-compat is that bridge.** It carries your `.claude/` directories **verbatim into DSH** — everything works immediately. Install once, and both sides share one config: change it in one place, it updates in both.

```bash
dsh plugin --profile web add dsh-claude-compat@latest
dsh web
```

Done. Your skills show up in the `/` menu, rules inject into every new session, and you can invoke agents with `/agent-name` — all inside DSH, exactly like Claude Code.

**Or let DSH install it itself (recommended):** copy this line to DSH — it reads the skill, installs, and verifies:

> Read https://github.com/biedongbin/dsh-claude-compat/blob/main/.claude/skills/install-dsh-compat/SKILL.md and install the dsh-claude-compat plugin following its steps.

> ⭐ Find this useful? [Give it a star](https://github.com/biedongbin/dsh-claude-compat) — it keeps us improving and helps more people discover it.

---

## What it brings over — at a glance

| Your Claude Code asset | Becomes in DSH | How to use it |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill (lazy-loaded) | `/skill-name`, the `skill` tool, and the model-visible catalog |
| `commands/*.md` | DSH skill (user-invocable) | `/command-name` in the slash menu |
| `rules/*.md` | message-stream injection (same channel Claude uses) | auto-applies to every new session |
| `agents/*.md` | delegation-shim skill | invoke `/agent-name` with its persona |
| `.mcp.json`, `.claude.json`, `managed-mcp.json` | `dsh-mcp-client` instances | stdio / streamable-http auto-translated |
| `.claude/settings.json` hooks | 26 of 33 events, `command`, `http`, `mcp_tool`, `prompt` and `agent` handlers | commands, permissions, blocks behave as before |
| `~/.claude/plugins` | DSH skill (managed via `/cc-plugin`) | installed plugin skills work too |

Both the project `.claude/` and the user-level `~/.claude/` are read. Same-name entries dedupe by fixed priority: **project `.claude` > DSH native > `~/.claude`** — a project skill always wins over other copies, and a user skill never overrides a DSH-native one. `CLAUDE.md` / `AGENTS.md` are handled by DSH's built-in `dsh-agent-instructions` — **this plugin never touches them**.

## What it does (implementation detail)

| `.claude/` path | Mechanism | Behavior |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill provider | Name + description in the model-visible catalog; body loads on demand via the `skill` tool. New skills appear on the next catalog reconcile — no restart. |
| `commands/*.md` | DSH skill provider | Same, plus user-invocable: `/command-name` works in the slash menu. |
| `rules/*.md` | Message-stream injection | Rules are concatenated, wrapped in a `<system-reminder>` envelope, and prepended as a user-role message at the front of the message array once per session — the same channel Claude Code uses (`prependUserContext`), which models follow reliably. |
| `agents/*.md` | DSH skill provider (delegation shim) | DSH has no markdown subagent format, so each agent file becomes a **skill** whose body leads with an explicit "delegate with this persona" instruction. Model- and user-invocable, so `/agent-name` works. Same-name agents dedupe by rank like skills. |
| `managed-mcp.json`, `managedMcpServers`, `.claude.json`, `<projectRoot>/.mcp.json` | MCP servers | Claude Code-format MCP server definitions are read in Claude Code's precedence and mounted as `dsh-mcp-client` plugin instances at DSH startup from the launch workspace. `command` → stdio, `type: http` → streamable-http. Malformed entries or a missing `@deepseek-ai/dsh-mcp-client` degrade to a warning, never a crash. See [MCP servers](#mcp-servers). |
| `.claude/settings.json` → `hooks` | Hooks | Claude Code hooks, bridged onto the DSH extension points. See [Hooks](#hooks). |
| `~/.claude/plugins` (installed plugins) | DSH skill provider | Installed Claude Code plugin-marketplace plugins contribute their skills/commands/agents (via each install's `.claude-plugin/plugin.json` manifest, or a directory scan when manifest-less) at rank `750` — the long tail: project `.claude`, DSH native, and `~/.claude` all win collisions. Plugin MCP servers (`mcpServers` in the manifest) mount only when `enablePluginMcp` is opted in — mounting third-party MCP servers is a bigger trust step than listing skills. |

The same directories are also read from the **user-level** `~/.claude/` (skills, commands, rules, agents, and `~/.claude/settings.json` hooks). Same-name skills/commands/rules/agents are deduped with a fixed priority:

**project `.claude` > DSH native (`.dsh`) > `~/.claude`**

- Project `.claude` entries carry rank `50`; DSH's own skills — project `.dsh` roots, `.agents` roots, and bundled skills (ranks `100`–`600`, `BUNDLED_SKILL_RANK`) — sit in between; `~/.claude` entries rank `700`. So a project skill always overrides the DSH-native and user copies, and a user skill never overrides a DSH-native one.
- Rule files with the same basename in `~/.claude/rules` are skipped when the project already provides one.

`CLAUDE.md` / `AGENTS.md` are **not** touched — DSH's built-in `dsh-agent-instructions` already handles those.

## Built-in commands

Installing this plugin adds three management skills to the catalog:

| Command | What it does |
|---|---|
| `/cc-plugin` | Full Claude Code plugin management: `list`, `install <name>[@marketplace]`, `uninstall`, `enable`, `disable`, `update [name]`, `search <term>`, `marketplace list\|add\|remove\|update`. One-shot syntax `/cc-plugin <name>@<marketplace>` installs directly. Engine: the `claude` CLI when available, otherwise a built-in fallback (direct JSON + git, with timestamped backups of every file it touches). All state stays in Claude-native locations (`~/.claude/plugins`, `~/.claude/settings.json` `enabledPlugins`) so Claude Code and DSH read the same truth. |
| `/reload-cc-plugins` | Hot-reload the skill catalog: drop cached provider lists and notify observers so newly installed/removed skills appear in the **current session** — no restart, no new session. |
| `/reload-skills` | Alias of `/reload-cc-plugins`. |
| `/cc-export` | Export DSH-native skills (`.dsh/skills`) into Claude Code `.claude/skills/<name>/SKILL.md` with frontmatter preserved. `list` / `export [--overwrite] [--target]`. |
| `/cc-resume` | List Claude Code conversation sessions for the current project (`~/.claude/projects/`) and import any of them into DSH with full user/assistant/tool history. Imported sessions appear in the DSH session list titled `cc: <preview>` and resume like native ones. `list` / `import <sessionId>` / `--limit-turns N` for huge sessions. |

Typical loop: `/cc-plugin install ralph-loop@claude-plugins-official` → `/reload-cc-plugins` → new skills visible immediately. Plugin-shipped MCP servers still require a DSH restart (process-lifetime mount).

## Requirements

- DSH with a profile (e.g. `web`)
- A project using Claude Code conventions: `.claude/skills/`, `.claude/commands/`, `.claude/rules/`, `.claude/agents/`, `.claude/settings.json`, and a project-root `.mcp.json` (all optional; `~/.claude/` equivalents are also picked up)
- `pnpm` on `PATH` — `dsh plugin` is a thin pnpm forwarder

## Install / Update

One command — the package declares `dsh.bundle`, so DSH activates it automatically (no manual `cordis.patch.yml` editing). Install or update to the latest release:

```bash
dsh plugin --profile web add dsh-claude-compat@latest
```

Or from GitHub:

```bash
dsh plugin --profile web add github:biedongbin/dsh-claude-compat
```

Restart DSH (`dsh web`). Done — skills show up in `/`, rules are injected into every new session.

## Configuration

| Option | Default | Description |
|---|---|---|
| `enableSkills` | `true` | Register the `.claude/skills` + `.claude/commands` + `.claude/agents` provider (project and `~/.claude`) |
| `enableRules` | `true` | Inject project + `~/.claude` `rules/*.md` into the message stream |
| `enableMcp` | `true` | Translate `<projectRoot>/.mcp.json` into mounted MCP server plugins |
| `mcpFailOnStartupError` | `false` | Forward to `dsh-mcp-client`: fail plugin startup when an MCP server fails to connect |
| `enableHooks` | `true` | Run hooks from the `.claude/settings.json` files (see [Hooks](#hooks)) |
| `hooksTimeoutMs` | `60000` | Default per-hook run timeout in ms, 1 to 2147483647. A handler's own `timeout`, in seconds, overrides it. Like Claude Code, the default is 1.5 s for SessionEnd, 30 s for UserPromptSubmit and PostModelSwitch, and 10 s for MessageDisplay. prompt hooks default to 30 s and agent hooks to 60 s |
| `enableAgents` | `true` | Surface `.claude/agents/*.md` as delegation-shim skills |
| `skillAliases` | `{}` | Non-kebab (e.g. Chinese) name → ASCII slug map, e.g. `{ "三脑": "san-nao" }`. See “Non-ASCII skill names” below |
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

## Hooks

The plugin reads hooks from `~/.claude/settings.json`, `<project>/.claude/settings.json` and `<project>/.claude/settings.local.json`.
Each hook runs with the Claude Code JSON input on stdin, and its exit code and JSON output follow the Claude Code rules for the event.
Handler types are `command`, `http`, `mcp_tool`, `prompt` and `agent`, on the events that Claude Code allows them on.
A hook that fails (timeout, start error, other exit code) is logged with its reason and lets the action go on, unless `onFailure` is `"block"`.
A matcher of letters, digits, `_`, `-`, space, `,` and `|` is an exact list of names. Any other matcher is an unanchored regular expression.
A `*` that is not part of `.*`, as in `mcp__*__delete`, also works as the wildcard of earlier versions.
An event with no subject, such as Stop or UserPromptSubmit, ignores the matcher, as in Claude Code.
A hook's `if` rule is a filter that decides whether the hook runs, as in Claude Code. A Bash rule matches when any subcommand matches, so `if` does not prove that the whole command is safe: a hook that approves a request must check the command itself.
`session_id` is the DSH session id. Inside a subagent it stays the main session id, and `agent_id` and `agent_type` name the subagent.
`transcript_path` is empty, because DSH has no transcript file.

| Claude Code event | DSH extension point | Notes |
|---|---|---|
| SessionStart / SessionEnd | `agent/created` / `agent/disposed` | Main sessions only. SessionEnd default timeout is 1.5 s. |
| UserPromptSubmit | `agent/pre-step` | A block rejects the prompt. Context that this plugin injected is not a prompt. |
| PreToolUse | `tools/pre-execute` | `deny`, `ask` and a block map to DSH decisions. `updatedInput` makes DSH ask the user, with a warning, because DSH cannot change the input. A hook `allow` does not skip the approval of DSH, and it is logged once. |
| PermissionRequest / PermissionDenied | `approval/request` | `allow` and `deny` answer the request. When several hooks answer, a `deny` wins over an `allow`, so a failed `onFailure: "block"` hook always denies. PermissionDenied runs when DSH rejects an approval. |
| PostToolUse / PostToolUseFailure | `tools/post-execute` | `updatedToolOutput`, block feedback and context are applied. |
| PostToolBatch | first `agent/pre-step` after the results | A block rejects the step. |
| TaskCreated / TaskCompleted | `todo_write` | A new or completed todo is a task. A block denies the whole call. |
| Stop | `agent/turn-stopping` | A block or `additionalContext` steers the agent to continue. Stops after 8 continuations in a row (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). |
| StopFailure | `agent/error` | Model-request errors only. |
| SubagentStart / SubagentStop | `subagent/start` / `subagent/end` | Agent type is always `general-purpose`. SubagentStop cannot keep the subagent running. |
| Notification | `approval/request`, `user-questions/request`, `agent/status` | Types `permission_prompt`, `agent_needs_input`, `idle_prompt`. |
| MessageDisplay | `agent/assistant-stream` | Observe only. `displayContent` is ignored with a warning. |
| UserPromptExpansion | `command/run` on `session/event` | Observe only. Runs for every command, not only skills. |
| CwdChanged, PreCompact, PostCompact | `session/event` | Observe only. A PreCompact hook cannot stop the compaction. |
| PostModelSwitch | provider and model of the call configuration on `agent/request` | Context joins the next step. `source` is always `command`. A provider change with the same model name also counts. |
| TeammateIdle | `agent/status` and `team/member` | A block steers the teammate to keep working. |
| InstructionsLoaded | the plugin's own rules loader | `.claude/rules` files only, with `load_reason` `session_start`. |
| FileChanged | polling of the files that the matcher names | `watchPaths` from SessionStart, CwdChanged and FileChanged are watched too. |
| ConfigChange | polling of the settings files, and `skills/change` | Observe only. Hooks load at startup and are never reloaded, so the plugin logs that a changed settings file needs a restart. |

### Gaps: what cannot run in DSH

These seven events cannot run, because DSH has no extension point for them. The plugin warns, with the reason, when a settings file uses one.

| Event | Why it cannot run |
|---|---|
| `Setup` | DSH has no init or maintenance start flags. |
| `DirectoryAdded` | DSH reads `--add-dir` only at start, and emits no event. |
| `WorktreeCreate`, `WorktreeRemove` | The worktree work is a service method. No hook point wraps it, so a hook cannot replace it. |
| `Elicitation`, `ElicitationResult` | The DSH MCP client does not support elicitation. |
| `PreModelSwitch` | DSH applies a model change before a plugin sees it, so a hook cannot block it. `PostModelSwitch` runs. |

These events run, but with less power than in Claude Code:

| Behavior | Difference |
|---|---|
| `PreCompact`, `PostCompact`, `CwdChanged`, `MessageDisplay`, `UserPromptExpansion`, `ConfigChange` | Observe only. DSH reports them after the fact, so a hook cannot block or change them. |
| `PreToolUse` and `PermissionRequest` `updatedInput` | DSH cannot rewrite a tool call. PreToolUse asks the user, and a PermissionRequest `allow` with `updatedInput` is ignored, so the normal answerers decide. Both log a warning. |
| `MessageDisplay` `displayContent` | Ignored with a warning. DSH cannot change displayed text. |
| `SubagentStop` | A block cannot keep the subagent running. |
| `SubagentStart` and `SubagentStop` `agent_type` | Always `general-purpose`. DSH has no named subagent types. |
| `StopFailure` | Model-request errors only. |
| `Notification` | `permission_prompt`, `agent_needs_input` and `idle_prompt` only. |
| `PostModelSwitch` `source` | Always `command`. |
| `InstructionsLoaded` | `.claude/rules` files only, with `load_reason` `session_start`. The plugin does not load other instruction files, so it cannot report them. |
| `transcript_path` | Always empty, because DSH has no transcript file. |
| Settings reload | Hooks load at startup. A changed settings file is logged and needs a restart. |
| `agent` handler | DSH cannot limit the subagent to read-only tools. Inside it no `agent` hook runs, so it cannot start itself again. The other hooks run there, so a deny guard also covers its tool calls. |

Handler details:

- `mcp_tool` calls `mcp__<server>__<tool>` through the DSH tool service. `${path}` in a string of `input` is replaced from the hook input. A server that is still connecting is a failed hook.
- `prompt` asks the session model one question, with no tools. `model` is `provider/model`, or a model of the session provider. `continueOnBlock` and `impossible` follow the Claude Code rules.
- `agent` starts a DSH subagent through the `spawn` provider and reads its structured answer. DSH cannot limit its tools to read-only, so the prompt tells it to change no file, and DSH's normal approvals still guard any write. No `agent` hook runs inside that subagent, and every other hook does, so a PreToolUse deny guard also covers its tool calls.

## MCP servers

The plugin reads MCP servers from these sources, highest precedence first. A name in a higher source hides the same name below it, and the whole entry of the winning source is used. Plugin servers match by URL instead.

| Source | Where it is read |
|---|---|
| Managed | `managed-mcp.json` in the system Claude folder. It takes exclusive control: only this file and `managedMcpServers` load. |
| Managed settings | `managedMcpServers` in `managed-settings.json` in the system Claude folder. |
| Local | `.claude.json`, under `projects["<launch folder>"].mcpServers`. |
| Project | `<projectRoot>/.mcp.json`. |
| User | `.claude.json`, top-level `mcpServers`. The file is in `CLAUDE_CONFIG_DIR` when it is set, and in the home folder otherwise. |
| Plugin | Plugin `.mcp.json` files, only with `enablePluginMcp`. |

The system Claude folder is `/Library/Application Support/ClaudeCode` on macOS, `/etc/claude-code` on Linux, and `C:\Program Files\ClaudeCode` on Windows.

Failures fail closed where the policy is at stake:

- An unreadable `managed-settings.json` keeps every MCP server off.
- An unreadable `managed-mcp.json` keeps the user, project and local servers off. `managedMcpServers` still loads.
- A managed policy that is malformed keeps every MCP server off. That covers a policy list that is not a list, a malformed entry in it (including a host that does not parse), a variable that is not set, and an `allowManagedMcpServersOnly` that is not a boolean.
- An unreadable user, project or local file is reported with what it stops. Its entries are not read.

Every warning names the file or entry, and says what stays off.

Policy comes from the settings files:

- `deniedMcpServers` blocks a server by URL, command or name. The denylist always wins. Plugin servers obey it too.
- `allowedMcpServers` allows only the matching servers. The lists merge from every settings file, unless managed settings set `allowManagedMcpServersOnly`. Servers from `managedMcpServers` and `managed-mcp.json` skip the allowlist.
- A malformed policy entry in a user, project or local settings file is ignored with a warning. In managed settings it keeps every MCP server off. A policy list that is not a list allows nothing (for `allowedMcpServers`) or denies nothing (for `deniedMcpServers`), with a warning.
- A URL pattern with no port covers the default port only (443 for `https`), as Claude Code documents. A pattern with `*` in the host, or `*` as the port, covers every port. A `serverCommand` entry compares the command and its arguments. It does not compare `env` (as Claude Code documents), and it does not compare `cwd`.
- A policy entry that names a variable which is not set keeps the literal text, and a warning names the variable and the entry. In managed settings, that entry makes the whole managed policy fail closed.
- `disabledMcpjsonServers` in any settings file turns off project servers by name.
- `disabledMcpServers` under this project in `.claude.json` turns off user and managed servers by name.

Entry handling:

- `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`. An unset variable with no default keeps the literal text, and a warning names it.
- `timeout` sets the per-call limit in milliseconds. A value under 1000 is ignored.
- `headersHelper` runs at mount, with a 10-second limit. Its JSON output overrides the static `headers`. A helper that fails skips its server. Under an `allowedMcpServers` list, only organization servers may use a helper, because the list cannot see the helper command.
- `type: stdio` and `type: http` (or `streamable-http`) run. An entry with a `url` and no `type` is skipped, as Claude Code skips it.
- A field of the wrong type, such as a non-string `args` item, skips the entry. The warning names the field.
- Stdio servers get `CLAUDE_PROJECT_DIR` in their environment.

### Gaps: what cannot run in DSH

These Claude Code features do not run here. The plugin warns when a file uses one, and the rest of the entry still loads.

| Claude Code feature | Why it cannot run |
|---|---|
| `type: sse` and `type: ws` | DSH's MCP client has stdio and streamable-http only. The entry is skipped. |
| `oauth` | DSH's MCP client has no OAuth flow. The server loads without it, and it may fail to connect. |
| `alwaysLoad` | DSH loads every tool at startup. There is no deferred tool loading. The field is ignored. |
| `headersHelper` on reconnect | DSH sets headers once, at mount. The helper does not run again on reconnect or after a 401. |
| `headersHelper` on plugin servers | Not run. A plugin server with a helper is skipped, with a warning, because it could not authenticate. |
| Server-managed settings, MDM profiles and registry policy | Only the files on disk are read. |
| `--mcp-config` and `--strict-mcp-config` | DSH has no launch flag for them. |
| claude.ai connectors | They need a claude.ai account fetch. |
| `enableAllProjectMcpServers` and `enabledMcpjsonServers` | Ignored. Project servers always load, as `claude -p` loads them. DSH has no approval prompt. |
| `enabledMcpServers` | Opt-in list for built-in servers. DSH has no built-in MCP servers. |
| Subagent `mcpServers` in `agents/*.md` | Not read by this plugin. Upstream PR #5 (MCP in agent realms) is the related work. |
| `${VAR}` in policy entries | Expands from the live process environment. Claude Code pins that environment. |
| Default `timeout` | 60 seconds. Claude Code uses about 28 hours. |

## Notes

- **Skill naming**: DSH requires kebab-case skill names. Nested skill directories are flattened (`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`); invalid frontmatter names fall back to the directory name.
- **MCP lifecycle**: MCP files are read once at DSH startup from the launch workspace — not per session — and each server mounts for the process lifetime. Restart DSH to pick up edits.
- **Project hooks**: the plugin has no workspace-trust prompt. A hook in `<project>/.claude/settings.json` or `<project>/.claude/settings.local.json` runs when DSH opens that project, with your permissions. Open only projects you trust.
  The plugin reads the project settings once, from the directory where DSH started, and not from the directory of each session. A PermissionRequest hook also gets the `reason` that DSH asks with, so it can tell a sandbox escalation from a plain approval.
- **Hooks scope**: 26 of the 33 Claude Code hook events run, with all five handler types. See [Hooks](#hooks) for the DSH point behind each event and the events that cannot run.
- **Rules granularity**: rules are read per new session (cached per session cwd). Editing a rule mid-session takes effect in the next session.
- **Rules content**: rules are injected verbatim as instructions to the model. Only commit rules you want the model to follow — same trust level as `CLAUDE.md`.
- **Catalog snapshot timing**: the skill catalog is snapshotted when a session is created. Skills installed or edited mid-session surface after `/reload-cc-plugins` (hot reload) or in the next session.

### Non-ASCII skill names

DSH's skill-name grammar is fixed to kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, defined in `@deepseek-ai/dsh-skill` and enforced by the registry before a candidate is read), so **a Chinese name can never reach the registry, no matter what this plugin emits** — emitting it anyway only moves the failure one layer down (`get()` returns `void 0`).

The plugin's answer is an explicit map from the original name to a legal slug, keeping the original name at the front of the description:

```yaml
skillAliases:
  三脑: tri-brain
  读知乎: read-zhihu
```

- The `name` becomes the slug (`/tri-brain` in the slash menu); the `description` becomes `三脑 — 三脑复核（…）`.
- **A legal name always beats an alias** — a skill DSH can already load is never renamed.
- Aliased entries keep their provider's rank, so a collision with a DSH-native or `~/.agents` skill is deduped exactly like any other duplicate (a `~/.claude` alias loses to an `~/.agents` skill of the same name rather than shadowing it). Lower `userSkillRank` below 500 to make `~/.claude` win.
- Un-mapped non-kebab names no longer vanish silently: one warning per file per process, with a paste-ready mapping example.

## Troubleshooting

### Known limitation: `/cc-resume` via the skill tool

In some DSH runtime configurations the `skill` tool resolves in an agent-scoped
layer where globally registered providers are not visible — the invocation
returns `skill "cc-resume" is unknown or no longer available` even though the
catalog lists it. This is a DSH runtime layering behavior, not a plugin bug.
The skill body only instructs the model to run the CLI, which is always
available:

```bash
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs list
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs import <sessionId>
```

**DSH won't start back up after a restart / port 3080 stuck.** Old process still holding the port (symptom: `EADDRINUSE` in logs). Use the bundled restart script — it waits for a clean stop, falls back to SIGKILL, and verifies the port before reporting success:

```bash
npx dsh-claude-compat-restart        # bin alias (installed with the package)
bash node_modules/dsh-claude-compat/scripts/dsh-restart.sh   # direct
bash scripts/dsh-restart.sh --no-patch   # skip the prompt patch, restart only
```

The script also re-applies the idempotent `dsh-terminal-bash` prompt patch, which npx/npm updates silently revert. `DSH_RESTART_PORT` overrides the port (default 3080).

**Installed a plugin via `/cc-plugin` but its skills don't show.** Run `/reload-cc-plugins`. Still missing → restart DSH (plugin-shipped MCP servers always need a restart).

**`/cc-resume` import fails on compression.** The importer needs the `zstd` binary (macOS: `brew install zstd`; most Linux images ship it).

**`/cc-plugin` reports "claude CLI unavailable".** The fallback engine handles install/enable/disable; for marketplace add/update, install Claude Code (`npm install -g @anthropic-ai/claude-code`) or manage marketplaces from Claude Code directly.

## Release notes

- **[Changelog](CHANGELOG.md) ([简体中文](CHANGELOG.zh-CN.md))** — release history from 0.1.0 to the latest version.

## Acknowledgments

- [Linux.do](https://linux.do) — community
- [Claude Code](https://claude.com/claude-code) — the `.claude/` conventions this plugin bridges
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) — the runtime this plugin extends

## License

[MIT](LICENSE)

## 📈 NPM Downloads

![NPM Downloads](.github/assets/downloads.svg)

[Data: api.npmjs.org](https://www.npmjs.com/package/dsh-claude-compat) · [npmtrends](https://npmtrends.com/dsh-claude-compat/)

## ⭐ Star History

If this project helps you, please give it a ⭐ — it motivates us to keep improving.

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

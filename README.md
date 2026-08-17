<p align="center">
  <img src="https://img.shields.io/badge/dsh-plugin-blue?style=for-the-badge" alt="DSH Plugin">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/🌐_简体中文-点我阅读中文-red?style=for-the-badge" alt="简体中文"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.4.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

<p align="center">DeepSeek Harness plugin that bridges Claude Code's <code>.claude/</code> directory into DSH natively — reuse your skills, slash commands, rules, agents, hooks, and MCP servers with zero migration.</p>

## What it does

| `.claude/` path | Mechanism | Behavior |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill provider | Name + description in the model-visible catalog; body loads on demand via the `skill` tool. New skills appear on the next catalog reconcile — no restart. |
| `commands/*.md` | DSH skill provider | Same, plus user-invocable: `/command-name` works in the slash menu. |
| `rules/*.md` | Message-stream injection | Rules are concatenated, wrapped in a `<system-reminder>` envelope, and prepended as a user-role message at the front of the message array once per session — the same channel Claude Code uses (`prependUserContext`), which models follow reliably. |
| `agents/*.md` | DSH skill provider (delegation shim) | DSH has no markdown subagent format, so each agent file becomes a **skill** whose body leads with an explicit "delegate with this persona" instruction. Model- and user-invocable, so `/agent-name` works. Same-name agents dedupe by rank like skills. |
| `.claude/settings.json` → `hooks` | Tool/prompt hooks | Claude Code hooks subset bridged onto DSH's `tools/pre-execute` (PreToolUse), `tools/post-execute` (PostToolUse) and `agent/pre-step` (UserPromptSubmit) waterfalls. Commands run via `/bin/sh -c` with a Claude-style JSON payload on stdin; exit code 2 denies/blocks, `hookSpecificOutput` overrides are honored, timeouts allow through with a warning. |
| `<projectRoot>/.mcp.json` | MCP servers | Claude Code-format MCP server definitions are translated to `dsh-mcp-client` plugin instances at DSH startup from the launch workspace: `command` → stdio, `url` → streamable-http. Malformed entries or a missing `@deepseek-ai/dsh-mcp-client` degrade to a warning, never a crash. |

The same directories are also read from the **user-level** `~/.claude/` (skills, commands, rules, agents, and `~/.claude/settings.json` hooks). Same-name skills/commands/rules/agents are deduped with a fixed priority:

**project `.claude` > DSH native (`.dsh`) > `~/.claude`**

- Project `.claude` entries carry rank `50`; DSH's own skills — project `.dsh` roots, `.agents` roots, and bundled skills (ranks `100`–`600`, `BUNDLED_SKILL_RANK`) — sit in between; `~/.claude` entries rank `700`. So a project skill always overrides the DSH-native and user copies, and a user skill never overrides a DSH-native one.
- Rule files with the same basename in `~/.claude/rules` are skipped when the project already provides one.

`CLAUDE.md` / `AGENTS.md` are **not** touched — DSH's built-in `dsh-agent-instructions` already handles those.

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
| `enableHooks` | `true` | Run `.claude/settings.json` hooks (Pre/PostToolUse, UserPromptSubmit) |
| `hooksTimeoutMs` | `60000` | Per-hook run timeout (UserPromptSubmit capped at 10s regardless) |
| `enableAgents` | `true` | Surface `.claude/agents/*.md` as delegation-shim skills |
| `rulesMaxBytes` | `65536` | Hard cap on total injected project rules text |
| `userRulesMaxBytes` | `65536` | Hard cap on total injected `~/.claude/rules` text |
| `projectRootMarkers` | `[".git"]` | Ancestor markers for project-root discovery |
| `skillRank` | `50` | Provider rank for project `.claude` skills (wins every DSH-native collision) |
| `skillSource` | `project-claude` | Source tag for project catalog entries |
| `userSkillRank` | `700` | Provider rank for `~/.claude` skills (loses to DSH-native `600`) |
| `userSkillSource` | `user-claude` | Source tag for `~/.claude` catalog entries |
| `userClaudeDir` | `~/.claude` | User-level `.claude` directory (`~` expands to the home dir) |

## Notes

- **Skill naming**: DSH requires kebab-case skill names. Nested skill directories are flattened (`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`); invalid frontmatter names fall back to the directory name.
- **MCP lifecycle**: `.mcp.json` is read once at DSH startup from the launch workspace — not per session — and each server mounts for the process lifetime. Restart DSH to pick up edits.
- **Hooks scope**: a deliberately small subset of Claude Code hooks: PreToolUse / PostToolUse / UserPromptSubmit. Matchers support exact names, `*` wildcards, and `|` alternation; commands run with `stdin` carrying the Claude-style JSON payload. Exit code 2 = deny (Pre) / block (Post); other non-zero exits and timeouts allow through with a warning.
- **Rules granularity**: rules are read per new session (cached per session cwd). Editing a rule mid-session takes effect in the next session.
- **Rules content**: rules are injected verbatim as instructions to the model. Only commit rules you want the model to follow — same trust level as `CLAUDE.md`.

## Acknowledgments

- [Linux.do](https://linux.do) — community
- [Claude Code](https://claude.com/claude-code) — the `.claude/` conventions this plugin bridges
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) — the runtime this plugin extends

## License

[MIT](LICENSE)

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

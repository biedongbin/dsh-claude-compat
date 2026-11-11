[← Project overview](../../../README.md) · [简体中文](../zh-cn/bridge-behavior.md)

# What it brings over — at a glance

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
| `managed-mcp.json`, `managedMcpServers`, `.claude.json`, `<projectRoot>/.mcp.json` | MCP servers | Claude Code-format MCP server definitions are read in Claude Code's precedence and mounted as `dsh-mcp-client` plugin instances at DSH startup from the launch workspace. `command` → stdio, `type: http` → streamable-http. Malformed entries or a missing `@deepseek-ai/dsh-mcp-client` degrade to a warning, never a crash. See [MCP servers](mcp.md#mcp-servers). |
| `.claude/settings.json` → `hooks` | Hooks | Claude Code hooks, bridged onto the DSH extension points. See [Hooks](hooks.md#hooks). |
| `~/.claude/plugins` (installed plugins) | DSH skill provider | Installed Claude Code plugin-marketplace plugins contribute their skills/commands/agents (via each install's `.claude-plugin/plugin.json` manifest, or a directory scan when manifest-less) at rank `750` — the long tail: project `.claude`, DSH native, and `~/.claude` all win collisions. Plugin MCP servers (`mcpServers` in the manifest) mount only when `enablePluginMcp` is opted in — mounting third-party MCP servers is a bigger trust step than listing skills. |

The same directories are also read from the **user-level** `~/.claude/` (skills, commands, rules, agents, and `~/.claude/settings.json` hooks). Same-name skills/commands/rules/agents are deduped with a fixed priority:

**project `.claude` > DSH native (`.dsh`) > `~/.claude`**

- Project `.claude` entries carry rank `50`; DSH's own skills — project `.dsh` roots, `.agents` roots, and bundled skills (ranks `100`–`600`, `BUNDLED_SKILL_RANK`) — sit in between; `~/.claude` entries rank `700`. So a project skill always overrides the DSH-native and user copies, and a user skill never overrides a DSH-native one.
- Rule files with the same basename in `~/.claude/rules` are skipped when the project already provides one.

`CLAUDE.md` / `AGENTS.md` are **not** touched — DSH's built-in `dsh-agent-instructions` already handles those.

## Notes

- **Skill naming**: DSH requires kebab-case skill names. Nested skill directories are flattened (`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`); invalid frontmatter names fall back to the directory name.
- **MCP lifecycle**: MCP files are read once at DSH startup from the launch workspace — not per session — and each server mounts for the process lifetime. Restart DSH to pick up edits.
- **Project hooks**: the plugin has no workspace-trust prompt. A hook in `<project>/.claude/settings.json` or `<project>/.claude/settings.local.json` runs when DSH opens that project, with your permissions. Open only projects you trust.
  The plugin reads the project settings once, from the directory where DSH started, and not from the directory of each session. A PermissionRequest hook also gets the `reason` that DSH asks with, so it can tell a sandbox escalation from a plain approval.
- **Hooks scope**: 26 of the 33 Claude Code hook events run, with all five handler types. See [Hooks](hooks.md#hooks) for the DSH point behind each event and the events that cannot run.
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

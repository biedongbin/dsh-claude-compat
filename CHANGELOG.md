# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/).

## [0.8.0] — 2026-08-19

### Added
- **Session lifecycle hooks**: `SessionStart` → `agent/session-start`, `SessionEnd` → `agent/disposed`. Fire-and-forget (best-effort, non-zero exit logged, never blocks the loop). Payload carries `session_id` + `cwd`.
- **`/cc-export`**: export DSH-native skills (`.dsh/skills`) into Claude Code `.claude/skills/<name>/SKILL.md` with frontmatter preserved; multiline values emit as YAML literal blocks. `list` / `export [--overwrite] [--target]`.

### Fixed
- **Session hook agent extraction**: DSH agent events dispatch `(carrier, name, payload)` and pass the agent on the **first argument** (`carrier.agent`), not the payload — verified in an isolated sandbox. Listeners now read `carrier?.agent ?? payload?.agent` (defensive against agent-loop's fused-payload path). Previously `session_id` was always `'unknown'`.

## [0.7.0] — 2026-08-18

### Added
- **`/cc-resume` — Claude Code session resume**: list conversations stored under `~/.claude/projects/<munged-cwd>/*.jsonl` (id, date, message count, first-user-text preview, imported marker) and import any session into DSH as a native event-sourced log (`~/.dsh/sessions/<munged>/session-cc-<id>/session.jsonl.zstd`). Imported sessions carry full user/assistant/tool history, a `cc: <preview>` title, and open/resume like any DSH session.
- Translation rules: main thread only (Claude sidechains skipped); thinking blocks dropped (DSH reasoning is stream-chunk based); tool_use/tool_result paired into DSH `tool/call`/`tool/result` events; `--limit-turns N` imports just the tail of huge sessions; idempotent re-import.
- **zstd frame layout fix**: the session header line is compressed as its own first zstd frame (DSH's `assertZstdHeaderFrame` requires it), events follow in a second frame — single-frame compression made DSH fail to parse imported logs.

- `scripts/cc-resume.mjs` is also a standalone CLI (`list` / `import <sessionId>`); requires the `zstd` binary on PATH.

### Known issues
- The `skill` tool may fail to resolve plugin-provided skills (`unknown or no longer available`) in agent-scoped runtime layers even though the catalog lists them — a DSH runtime layering behavior. `/cc-resume` degrades gracefully: run `scripts/cc-resume.mjs` directly (the skill body only wraps the CLI).

## [0.6.2] — 2026-08-18

### Changed
- **Renamed built-in commands**: `/plugin` → `/cc-plugin`, `/reload-plugins` → `/reload-cc-plugins`. The generic `plugin` name was likely to collide with DSH-native or third-party skills; the `cc-` prefix marks Claude Code bridge commands unambiguously. `/reload-skills` kept as an alias.

### Added
- **`scripts/dsh-restart.sh`** — portable, safe DSH Web restart with idempotent terminal-bash prompt patch:
  - Zero hardcoded user paths: discovers `dsh` via PATH, nvm, or npx cache (`~/.npm/_npx/*/node_modules/.bin/dsh`).
  - Patches **every** installed copy of `dsh-terminal-bash` found on the machine.
  - Cross-platform `sed` (GNU/BSD), SIGKILL fallback, startup-crash detection, `--no-patch` mode, `DSH_RESTART_PORT` override.
  - Shipped in the npm tarball (`files`) and exposed as bin alias `dsh-claude-compat-restart`.
- README: built-in commands section, `enablePluginManager`/`pluginManagerRank` config entries, troubleshooting section (both languages).

## [0.6.1] — 2026-08-18

### Added
- **`/reload-plugins` (now `/reload-cc-plugins`) and `/reload-skills`** — hot catalog reload. Loading the reload skill definition IS the reload: `get()` calls the provider control's `invalidate()`, bumping the registry revision, dropping the collect cache, and broadcasting `skills/change` so the Web GUI skill picker refreshes **in the current session** — no restart, no new session needed. Plugin-shipped MCP servers still require a process restart.

## [0.6.0] — 2026-08-18

### Added
- **`/plugin` (now `/cc-plugin`) — full Claude Code plugin & marketplace management** as a user-invocable DSH skill:
  - Subcommands mirroring `claude plugin`: `list`, `install <name>[@marketplace]` (incl. one-shot `/cc-plugin name@market`), `uninstall`, `enable`, `disable`, `update [name]`, `search <term>`, `marketplace list|add|remove|update`.
  - Execution engine: **claude CLI first** (`claude plugin ...` when on PATH), **self-implemented fallback** (direct JSON + git manipulation) when unavailable — every mutated file gets a timestamped backup.
  - All state stays in Claude-native locations (`~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`, `~/.claude/settings.json` `enabledPlugins`) so Claude Code and DSH read the same truth; newly installed plugin content surfaces via the existing discovery bridge.
  - Hermetic test suite for the manager (`test/v060.test.js`); real-CLI lifecycle (install → disable → enable → uninstall) verified end-to-end against `claude` 2.1.220.

## [0.5.1] — 2026-08-17

### Fixed
- **MCP mount crash with non-promise plugin returns**: `ctx.plugin()` returns a Fiber (PromiseLike) in real cordis, but test/embedding environments may return plain objects. The `.catch` call is now guarded with a `typeof fiber.catch === 'function'` check instead of assumed. Also bumped the version to bust the pnpm tarball cache (same-name `.tgz` updates keep stale integrity checksums).

## [0.5.0] — 2026-08-17

### Added
- **Plugin marketplace support**: reads `~/.claude/plugins/installed_plugins.json` (v2 registry) and surfaces every installed plugin's skills, commands, and agents — manifest-driven (`.claude-plugin/plugin.json`) with a directory-scan fallback for manifest-less plugins. Content lands at rank `750` (the long tail: project `.claude`, DSH-native, and `~/.claude` all win same-name collisions).
- **Plugin MCP mounting (opt-in)**: `mcpServers` paths in plugin manifests translate to `dsh-mcp-client` instances when `enablePluginMcp: true`; `${CLAUDE_PLUGIN_ROOT}` is substituted with the install path.

## [0.4.0] — 2026-08-16

### Added
- **`.mcp.json` mounting**: project-root MCP server definitions translate to `dsh-mcp-client` plugin instances at DSH startup — `command` → stdio, `url` → streamable-http. Malformed entries or a missing client package degrade to a warning, never a crash. Read once per process from the launch workspace; restart to pick up edits.
- **Claude Code hooks subset**: `PreToolUse` → `tools/pre-execute` (exit 2 = deny), `PostToolUse` → `tools/post-execute` (exit 2 = block), `UserPromptSubmit` → `agent/pre-step`. Matchers support exact names, `*` wildcards, `|` alternation; commands run via `/bin/sh -c` with a Claude-style JSON payload on stdin; `hookSpecificOutput.permissionDecision` overrides honored; timeouts allow through with a warning.
- **`.claude/agents/*.md` shim**: DSH has no markdown subagent format, so each agent file becomes a delegation-shim **skill** (model- and user-invocable, `/agent-name` works). Frontmatter `name` must be kebab-case, otherwise the file stem is used; `description` maps to `whenToUse`. Same-name agents dedupe by rank like skills.

## [0.3.0] — 2026-08-15

### Added
- **User-level `~/.claude/` support**: skills, commands, rules, and `settings.json` hooks are picked up from the home directory in addition to the project. Fixed dedup priority: **project `.claude` (rank 50) > DSH native (100–600) > `~/.claude` (700)**. User rules with the same basename as a project rule are skipped.

## [0.2.0] — 2026-08-14

### Added
- **`dsh.bundle` declaration** for one-command activation: `dsh plugin --profile web add dsh-claude-compat` activates the plugin automatically — no manual `cordis.patch.yml` editing.

## [0.1.0] — 2026-08-13

### Added
- Initial release: bridges Claude Code's project `.claude/` into DeepSeek Harness.
  - `skills/**/SKILL.md` → DSH skill provider (catalog name/description, on-demand body load).
  - `commands/*.md` → user-invocable skills (`/command-name` in the slash menu).
  - `rules/*.md` → message-stream injection: concatenated, wrapped in a `<system-reminder>` envelope, prepended once per session — the same channel Claude Code uses (`prependUserContext`), which models follow reliably.

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

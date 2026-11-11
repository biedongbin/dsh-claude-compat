[← Project overview](../../../README.md) · [简体中文](../zh-cn/commands.md)

# Built-in commands

Installing this plugin adds five native management commands:

| Command | What it does |
|---|---|
| `/cc-plugin` | Open the plugin manager, or use `list`, `install <name>[@marketplace]`, `uninstall`, `enable`, `disable`, `update [name]`, `search <term>`, and `marketplace list\|add\|remove\|update`. `/cc-plugin <name>@<marketplace>` installs directly. Changes require the `claude` CLI in user scope; missing CLI, authentication and network errors are reported without direct JSON or git fallback writes. Claude Code and DSH read the same configured plugin registry and settings. |
| `/reload-cc-plugins` | Refresh the skill catalog in the **current session**, waiting for invalidation to complete and reporting failures. Newly installed or removed skills appear without creating another session. MCP and hook changes still require a DSH restart. |
| `/reload-skills` | Alias of `/reload-cc-plugins`. |
| `/cc-export` | List or export DSH-native skills (`.dsh/skills`) to Claude Code `.claude/skills/<name>/SKILL.md`, preserving frontmatter. Uses the Session's effective directory and a real Node interpreter on Desktop. `list` / `export [--overwrite] [--target <directory>]`; relative targets follow the effective directory. |
| `/cc-resume` | Browse Claude history and hand its background to DSH. A conversation command card continues in its owning DSH session; the management page creates a normal new conversation in the source project's Workspace. `list` / `resume <Claude sessionId> [--cwd source-project] [--limit-turns N]`; `import` aliases `resume`, while `archive` retains the separate legacy archive copy. |

Typical loop: `/cc-plugin install ralph-loop@claude-plugins-official` → `/reload-cc-plugins` → new skills visible immediately. Plugin-shipped MCP servers still require a DSH restart (process-lifetime mount).

### Context handoff and legacy archives

One-click continuation locates the configured Claude `projects/` source and submits only its path with a short reading request. DSH reads it as needed and first describes the background, current task state and next-step plan. The plugin does not inline the transcript, scan the whole file or automatically execute historical pending work. Source lookup and the target DSH session identity remain separate; directory changes inside Claude history do not reject handoff.

The native page and commands honor `userClaudeDir`. Use `/cc-resume resume <id> --cwd <source-project>` to select another source folder while continuing in the invoking DSH session. Explicit `archive` and `sessions.import` remain separate archive operations that preserve existing DSH logs. The standalone CLI is a legacy format utility, and is not used by one-click continuation.

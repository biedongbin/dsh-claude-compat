[← Project overview](../../../README.md) · [简体中文](../zh-cn/troubleshooting.md)

# Troubleshooting

### Legacy archive CLI

The standalone CLI is a legacy archive utility, separate from native file-reference handoff. Pass the project and custom Claude directory explicitly when creating an archive:

```bash
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs list --cwd /path/to/project
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs import <sessionId> --cwd /path/to/project --user-claude-dir /path/to/claude-config
```

**DSH won't start back up after a restart / port 3080 stuck.** Old process still holding the port (symptom: `EADDRINUSE` in logs). Use the bundled restart script — it waits for a clean stop, falls back to SIGKILL, and verifies the port before reporting success:

```bash
npx dsh-claude-compat-restart        # bin alias (installed with the package)
bash node_modules/dsh-claude-compat/scripts/dsh-restart.sh   # direct
bash scripts/dsh-restart.sh --no-patch   # skip the prompt patch, restart only
```

The script also re-applies the idempotent `dsh-terminal-bash` prompt patch, which npx/npm updates silently revert. `DSH_RESTART_PORT` overrides the port (default 3080).

**Installed a plugin via `/cc-plugin` but its skills don't show.** Run `/reload-cc-plugins`. Still missing → restart DSH (plugin-shipped MCP servers always need a restart).

**The legacy archive CLI reports a compression error.** That standalone utility requires `zstd` (macOS: `brew install zstd`). Native `/cc-resume` file-reference handoff does not compress the conversation and needs no `zstd` binary.

**`/cc-plugin` reports "claude CLI unavailable".** Install Claude Code (`npm install -g @anthropic-ai/claude-code`) to change plugins or marketplaces. Browsing local catalogs remains available; failed mutations do not fall back to direct registry writes.

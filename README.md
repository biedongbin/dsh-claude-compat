# dsh-claude-compat

[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) plugin: bridge Claude Code's `.claude/` directory into DSH natively.

Reuse your existing Claude Code project setup — skills, slash commands, and rules work in DSH with zero migration.

## What it does

| `.claude/` path | Mechanism | Behavior |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill provider | Name + description in the model-visible catalog; body loads on demand via the `skill` tool. New skills appear on the next catalog reconcile — no restart. |
| `commands/*.md` | DSH skill provider | Same, plus user-invocable: `/command-name` works in the slash menu. |
| `rules/*.md` | Message-stream injection | Rules are concatenated, wrapped in a `<system-reminder>` envelope, and prepended as a user-role message at the front of the message array once per session — the same channel Claude Code uses (`prependUserContext`), which models follow reliably. |

`CLAUDE.md` / `AGENTS.md` are **not** touched — DSH's built-in `dsh-agent-instructions` already handles those.

## Requirements

- DSH with a profile (e.g. `web`)
- A project using Claude Code conventions: `.claude/skills/`, `.claude/commands/`, `.claude/rules/`

## Install

```bash
dsh plugin --profile web add dsh-claude-compat
```

Then register it in `~/.dsh/profiles/web/cordis.patch.yml` (merge into your existing patch list):

```yaml
- insert:
    - id: claude-compat
      name: 'dsh-claude-compat'
      config:
        enableSkills: true
        enableRules: true
```

Restart DSH (`dsh web`). Done — skills show up in `/`, rules are injected into every new session.

## Configuration

| Option | Default | Description |
|---|---|---|
| `enableSkills` | `true` | Register the `.claude/skills` + `.claude/commands` provider |
| `enableRules` | `true` | Inject `.claude/rules/*.md` into the message stream |
| `rulesMaxBytes` | `65536` | Hard cap on total injected rules text |
| `projectRootMarkers` | `[".git"]` | Ancestor markers for project-root discovery |
| `skillRank` | `150` | Provider rank: between DSH-native `.dsh/skills` (100) and `.agents/skills` (200) — DSH-native wins conflicts |
| `skillSource` | `project-claude` | Source tag for catalog entries |

## Notes

- **Skill naming**: DSH requires kebab-case skill names. Nested skill directories are flattened (`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`); invalid frontmatter names fall back to the directory name.
- **Rules granularity**: rules are read per new session (cached per session cwd). Editing a rule mid-session takes effect in the next session.
- **Rules content**: rules are injected verbatim as instructions to the model. Only commit rules you want the model to follow — same trust level as `CLAUDE.md`.

## License

MIT

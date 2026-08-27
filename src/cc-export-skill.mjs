// Skill body for /cc-export — instructs the model to drive scripts/cc-export.mjs.
export const CC_EXPORT_SKILL_BODY = `# Export DSH Skills to Claude Code

Export DSH-native skills (\`.dsh/skills\`) into Claude Code's
\`.claude/skills/\` format, closing the DSH → Claude loop. Each DSH skill becomes
\`.claude/skills/<name>/SKILL.md\` with name/description frontmatter, so Claude
Code picks it up with zero edits.

## Commands
Run from the session's working directory (or pass \`--cwd <dir>\`):

1. **List** DSH skills available to export:
   \`\`\`bash
   node <plugin-root>/scripts/cc-export.mjs list
   \`\`\`

2. **Export** them into \`.claude/skills/\`:
   \`\`\`bash
   node <plugin-root>/scripts/cc-export.mjs export
   \`\`\`
   Options: \`--overwrite\` replaces existing files (default: skip existing),
   \`--cwd <dir>\` overrides the project directory, \`--target <dir>\` writes
   somewhere other than \`.claude/skills\`.

3. Tell the user: Claude Code will pick up the exported skills under
   \`.claude/skills/\` on next load (or after /reload-skills if running).

## Behavior notes
- Existing target files are skipped unless \`--overwrite\` is passed.
- DSH skill names are already kebab-case, so they map 1:1 to Claude skill names.
- Skills without frontmatter get a synthesized name/description so Claude Code
  accepts them.
- Other frontmatter keys (e.g. \`author\`) are preserved through the round-trip.`;

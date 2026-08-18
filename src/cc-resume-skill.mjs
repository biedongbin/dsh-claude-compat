// Skill body for /cc-resume — instructs the model to drive scripts/cc-resume.mjs.
export const CC_RESUME_SKILL_BODY = `# Claude Code Session Resume

List and import Claude Code conversation sessions into DSH. Imported sessions
appear in the DSH session list (refresh the GUI) with full user/assistant/tool
history and can be resumed like any native session.

## Commands
Run from the session's working directory (or pass \`--cwd <dir>\`):

1. **List** Claude sessions for the current project:
   \`\`\`bash
   node <plugin-root>/scripts/cc-resume.mjs list --limit 20
   \`\`\`
   Output: one line per session — imported marker (\`*\`), id, date, message
   count, first-user-text preview. Pick the \`sessionId\` the user wants.

2. **Import** a session:
   \`\`\`bash
   node <plugin-root>/scripts/cc-resume.mjs import <sessionId>
   \`\`\`
   Options: \`--limit-turns N\` imports only the last N turns (useful for huge
   sessions), \`--cwd <dir>\` overrides the project directory.

3. Tell the user: refresh the DSH GUI session list and open the session titled
   \`cc: <preview>\`, or the imported id can be resumed directly.

## Behavior notes
- Imports are main-thread only (Claude sidechain/subagent messages skipped).
- Thinking blocks are dropped (DSH reasoning is stream-based; replaying
  reconstructed reasoning would corrupt the log).
- Re-importing the same session is idempotent (same target, events rewritten).
- The imported conversation is static history — continuing it starts a fresh
  DSH turn flow on top of that context.
- Requires the \`zstd\` binary on PATH (macOS: \`brew install zstd\`).`;

// Skill body for /cc-resume — instructs the model to drive scripts/cc-resume.mjs.
// This body is ALSO the playbook for the interactive /cc-resume command: the
// command's steered message hands the agent a candidate list and defers the
// procedure here, so keep the interactive flow section in sync with what
// src/commands.js injects.
export const CC_RESUME_SKILL_BODY = `# Claude Code Session Resume

List and import Claude Code conversation sessions into DSH. Imported sessions
appear in the DSH session list (refresh the GUI) with full user/assistant/tool
history and can be resumed like any native session.

## Interactive flow (candidate list handed to you — e.g. via /cc-resume)

When a /cc-resume steering message hands you a numbered candidate list:

1. Immediately call ask_user_question with ONE option per candidate:
   - label: \`<n>. <8-char id prefix> · <MM-dd HH:mm> · <N>msg\`
   - description: the session title preview
   - plus one final option "换其他项目目录".
   Do NOT re-print the list as text; the picker IS the presentation.
2. On selection, import via bash:
   \`\`\`bash
   node <plugin-root>/scripts/cc-resume.mjs import <id-prefix> --cwd <cwd-from-the-steering-message>
   \`\`\`
   The 8-char prefix resolves if unique; on "ambiguous prefix" error ask the
   user to pick again or use a longer prefix.
3. Sessions over ~1000 msgs: ask one confirm question first — offer
   \`--limit-turns 200\` (imports just the recent tail, much faster).
4. On success tell the user: refresh the DSH session list, then open the
   session titled \`cc: <preview>\`.
5. On "换其他项目目录": ask for the path (offer likely candidates from
   ~/.claude/projects), then run \`list --cwd <dir>\` and go back to step 1.

## Commands (direct, no agent round-trip)
Run from the session's working directory (or pass \`--cwd <dir>\`):

1. **List** Claude sessions for the current project:
   \`\`\`bash
   node <plugin-root>/scripts/cc-resume.mjs list --limit 20
   \`\`\`
   Output: one line per session — imported marker (✓), id, date, message
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

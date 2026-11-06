// Model-facing fallback for the same context handoff used by the native browser.
export const CC_RESUME_SKILL_BODY = `# Continue a Claude Code task in DSH

Use claude_compat to locate Claude history and ask DSH to read its source file.
/cc-resume opens the native history browser. A click inside that command card
continues in its owning DSH conversation. A click from the management page
creates a normal new DSH conversation in the Claude source project's workspace.

1. Use sessions.projects and sessions.list to locate the user's selected source;
   cwd identifies its Claude project folder, and sessionId is the full Claude ID.
   sessions.preview provides a bounded preview.
2. Call sessions.resume. Set targetSessionId only when the user wants an existing
   DSH conversation to take over; omit it to create a normal new DSH conversation.
   limitTurns optionally asks DSH to focus on the most recent N user turns.
3. Report the target DSH sessionId and whether the reading request was accepted.
   Acceptance means DSH queued the instruction, not that it has read the file.

Only the source file path and a short reading instruction are submitted. Do not
paste the transcript or generate a historical-content prompt. DSH reads the file
in chunks as needed, then briefly describes the background, current task state
and next-step plan. Current-session handoff retains that conversation, its
existing messages, model and working directory.

sessions.import is a separate legacy archive-copy operation. Do not substitute it
for context handoff or open an old imported archive as a one-click continuation.
`;

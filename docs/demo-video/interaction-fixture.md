# Conversation recording fixture / 对话录制演示素材

This is explicitly synthetic demonstration material. The local skill is not a shipped product capability. No existing history, configuration, credentials or authentication state was read or changed.

## Files and schema

- Workspace: repository-relative `.tmp/conversation-demo-workspace`. Resolve it to an absolute directory before selecting it in DSH. A fresh local Git repository (branch `demo`, no commits) establishes its own `.git` root boundary; `findProjectRoot(demoCwd)` was checked to return this workspace rather than the parent repository, so its local demo skill can be discovered. No existing repository or global Git configuration was modified.
- Workspace facts are retained only in the ignored local capture cache, not distributed with the repository. The same three public facts are embedded in the demo skill below.
- [Demo skill](fixtures/demo-brief/SKILL.md): `demo-brief`, explicitly labelled “演示用 / Demo fixture”; answers with three short items and forbids tools/network/install/modification.
- The machine-local manifest stays in the ignored capture cache and is not distributed. It records the exact cwd, UUID and source path; these private paths must not appear in the recording.
- Synthetic history title: **Demo: release brief / 演示：发布摘要**. Session ID: `ced3ef6c-b42d-431e-ad57-5744d16a156c`.
- History is one newly created UUID-named JSONL under a newly created Claude project folder derived with `claudeProjectFolder(absoluteDemoCwd)` from [lib.js](../../src/lib.js#L116). Creation used exclusive `wx` and a nonrecursive new project-folder mkdir; it cannot overwrite an existing source.
- Records: one `custom-title`, one `user` and one `assistant`; absolute cwd is metadata only. Displayed message text contains only demo labels, supplied product facts and a concise next step.

## Capture instructions

1. Add/select this demo workspace in DSH and create an ordinary conversation there. Keep the demo label visible.
2. If the skill catalogue was created before this fixture, run `/reload-skills` in that conversation. For a newly created session, inspect the slash menu first; reload only if `demo-brief` is absent. No MCP/hooks changes or service restart are required.
3. Chinese example: select `/demo-brief` and ask “请用中文写三条简短发布摘要。” English example: “Write a concise three-item release brief in English.” The demo skill contains all facts and should not call tools.
4. To demonstrate history, open Claude Code → Sessions (历史会话), enter the absolute demo cwd in Project directory, Confirm, then search `Demo: release brief`. Refresh if the manager predates creation. Choose **Demo: release brief / 演示：发布摘要**. Do not choose a real history.
5. Preview should show the explicitly synthetic user task and assistant outline. Quick resume may send the fixture file reference for reading/summary; recording that model response is a separate parent-agent action, not performed by fixture preparation.
6. Mask absolute directory fields and machine-local paths in any UI or handoff prompt; do not replace message text to fabricate a result. Restore the original UI language afterward.

## Read-only validation performed

Used [createSessionImportService](../../src/session-import.js#L157) with explicit userClaudeDir, no runtime services: `listSessions({cwd, query: 'Demo: release brief'})` returned exactly this UUID/title and two messages; `preview({cwd,sessionId,limit:10})` returned two unclipped messages and no warnings; `prepareHandoff({cwd,sessionId})` resolved exactly this source and cwd with no warnings. Source SHA-256 was unchanged after all calls. No listProjects call was used because it samples other project histories. No services booted, model calls, real conversation reads, auth reads, installs or network requests occurred.

To repeat validation, resolve the demo cwd, load its local manifest, import createSessionImportService from the repository, and invoke only the three read-only methods above with the manifest's UUID. Do not invoke importSession or listProjects.

## Actual recording outcome

The recording used the existing dsh-claude-compat workspace. The demo skill was temporarily copied into its project `.claude/skills/demo-brief/`, refreshed through `/reload-skills`, and selected from the actual slash menu. After both recordings, the temporary active skill file and its newly created directory were removed; the source above remains as an inactive fixture. The isolated synthetic Claude history was selected by its demo project directory. Both history handoffs actually read that synthetic file and produced summaries. The English recording includes a separate English follow-up summary request. Both language skill runs produced real three-item model replies. No model output was substituted into the page. The synthetic history and ignored local fixture workspace remain for inspection; no pre-existing history was changed.

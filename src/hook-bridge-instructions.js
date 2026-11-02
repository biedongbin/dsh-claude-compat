// dsh-claude-compat: InstructionsLoaded.
//
// The plugin itself loads the `.claude/rules` files, so it knows when it does.
// Claude Code reports each instruction file with its scope and the reason it was
// loaded. This plugin loads rules at the start of a session only, so the reason is
// always `session_start`. CLAUDE.md and AGENTS.md belong to dsh-agent-instructions,
// which does not report them to this plugin.

const LOAD_REASON = 'session_start';

/**
 * Make the function that the rules loader calls after it adds rules to a session.
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 * @returns {(agent: object, files: {path: string, scope: 'Project'|'User'}[]) => void}
 */
export function createInstructionsNotifier(engine, support) {
  return (agent, files) => {
    if (!engine.has('instructions-loaded')) return;
    // One file after another, so a hook sees the files in load order.
    support.track((async () => {
      for (const file of files) {
        await engine.fire('instructions-loaded', 'InstructionsLoaded', {
          subject: LOAD_REASON,
          payload: support.payload('InstructionsLoaded', agent, {
            file_path: file.path,
            memory_type: file.scope,
            load_reason: LOAD_REASON,
          }),
        });
      }
    })());
  };
}

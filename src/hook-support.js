// dsh-claude-compat: helpers shared by the hook bridges (src/hook-bridge-*.js).

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { CLAUDE_COMPAT_SOURCE_KIND } from './lib.js';

// The agent type that DSH subagents report. DSH does not name a type for a run.
export const SUBAGENT_TYPE = 'general-purpose';

/** The session id of an agent, or of an object that only holds a session. */
export function sessionIdOf(agent) {
  return agent?.session?.header?.id ?? agent?.session?.id ?? '';
}

/** True for an agent that DSH created to run a subagent. */
export function isSubagent(agent) {
  return agent?.session?.header?.origin === 'subagent';
}

/** Flatten content blocks to the text a hook payload carries. */
export function blocksToText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * Support object for one plugin activation.
 * @param {object} ctx the DSH plugin context
 * @returns {object} helpers: payload, contextMessage, inject, track, drain
 */
export function createSupport(ctx) {
  const pending = new Set();

  return {
    ctx,

    // File watching for FileChanged. registerFileHooks replaces this with the real controller.
    files: { track() {}, release() {}, setDynamic() {}, cwdChanged() {} },

    // The agent's current directory. The working-directory service is optional,
    // so a deployment without it falls back to the session's start directory.
    cwd(agent) {
      const current = agent?.session === undefined ? undefined : ctx.workingDirectory?.get?.(agent.session);
      return current ?? agent?.session?.header?.cwd ?? process.cwd();
    },

    /**
     * Claude-shaped hook input: the common fields plus the event's own.
     * `session_id` is the DSH session id (the main session's id inside a subagent). `transcript_path` stays empty because
     * DSH exposes no transcript file path.
     */
    payload(claudeName, agent, fields = {}) {
      // Inside a subagent, `session_id` stays the main session and `agent_id` names the subagent.
      const subagent = isSubagent(agent);
      const parent = agent?.session?.header?.parentSession;
      return {
        session_id: subagent && parent !== undefined ? parent : sessionIdOf(agent),
        transcript_path: '',
        cwd: this.cwd(agent),
        hook_event_name: claudeName,
        ...subagent ? { agent_id: sessionIdOf(agent), agent_type: SUBAGENT_TYPE } : {},
        ...fields,
      };
    },

    contextMessage(text) {
      return createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: CLAUDE_COMPAT_SOURCE_KIND, form: 'hook-context' },
      });
    },

    /** Messages for the `additionalContext` of an outcome. */
    contextMessages(outcome) {
      return outcome.contexts.map((text) => this.contextMessage(text));
    },

    /** Add the outcome's context to a running agent, so the model sees it on its next step. */
    inject(agent, outcome) {
      if (agent === undefined) return;
      for (const message of this.contextMessages(outcome)) agent.inject(message);
    },

    /**
     * Callback for `asyncRewake` hooks: an exit 2 steers the agent with the hook
     * output as a system reminder. Undefined when there is no agent to wake.
     */
    rewake(agent) {
      if (typeof agent?.steer !== 'function') return undefined;
      return (text) => agent.steer(this.contextMessage(`<system-reminder>\n${text}\n</system-reminder>`));
    },

    /** Keep a background run alive until it settles, so disposal can wait for it. */
    track(promise) {
      const tracked = promise.catch((error) => {
        console.warn(`dsh-claude-compat: hook run failed: ${error?.message ?? error}`);
      }).finally(() => pending.delete(tracked));
      pending.add(tracked);
      return tracked;
    },

    drain() {
      return Promise.allSettled([...pending]);
    },
  };
}

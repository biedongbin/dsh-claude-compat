// dsh-claude-compat: runs the hooks configured for one event and folds their
// results into one outcome. The DSH bridges (src/hook-bridge-*.js) call
// `engine.fire(...)` at a DSH extension point and map the outcome onto a DSH
// decision.

import { NO_ONFAILURE_EVENTS } from './hook-events.js';
import { runHandler } from './hook-handlers.js';
import { interpretRun, mergeOutcomes } from './hook-output.js';
import { matchIfRule } from './hook-spec.js';

// A matcher with only these characters is an exact name, or a list of exact names.
// StopFailure and FileChanged use the narrower set: no hyphen, space or comma.
const EXACT_LIST = /^[A-Za-z0-9_\- ,|]*$/;
const EXACT_LIST_NARROW = /^[A-Za-z0-9_|]*$/;
const NARROW_EVENTS = new Set(['stop-failure', 'file-changed']);

/**
 * Compile a Claude Code hook matcher into a predicate on the event subject.
 * "*", an empty string, and a blank string match everything. A matcher of letters,
 * digits, `_`, `-`, space, `,` and `|` is a list of exact names. Any other matcher
 * is an unanchored JavaScript regular expression. A regular expression that does not
 * parse never matches, and its predicate has an `invalid` message. A matcher that is
 * not a string never matches.
 * @param {unknown} matcher
 * @param {{narrow?: boolean}} [options] `narrow` for the events that accept only `|`
 * @returns {((name: string) => boolean) & {invalid?: string}}
 */
export function compileMatcher(matcher, { narrow = false } = {}) {
  if (typeof matcher !== 'string') return () => false;
  if (matcher.trim() === '' || matcher === '*') return () => true;
  if ((narrow ? EXACT_LIST_NARROW : EXACT_LIST).test(matcher)) {
    const names = matcher.split(narrow ? '|' : /[|,]/).map((name) => name.trim());
    return (name) => names.includes(name);
  }
  try {
    const pattern = new RegExp(matcher);
    return (name) => pattern.test(name);
  } catch (error) {
    const never = () => false;
    never.invalid = error.message;
    return never;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const TYPE_TIMEOUT_MS = { prompt: 30_000, agent: 60_000 };

// Log text for a failed run: the reason, the hook, and the end of its output.
function failureText(run, hook) {
  const tail = run.stdout.trim();
  const label = hook.command ?? hook.url ?? hook.tool ?? hook.prompt?.slice(0, 40) ?? hook.type;
  return `${run.reason}: ${label}${tail === '' ? '' : ` (output: ${tail.slice(-500)})`}`;
}

// `onFailure: "block"` makes a failed hook block the event. Exit code 2 does that on
// most events. PermissionRequest ignores exit code 2, so it gets a deny decision.
function applyOnFailure(run, hook, event) {
  if (!run.failed || hook.onFailure !== 'block' || NO_ONFAILURE_EVENTS.has(event)) return run;
  const label = hook.command ?? hook.url ?? hook.tool ?? hook.type;
  const message = `hook failed (${run.reason}): ${label}`;
  if (event === 'permission-request') {
    const decision = { behavior: 'deny', message };
    const output = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
    return { exitCode: 0, stdout: JSON.stringify(output), failed: false };
  }
  return { exitCode: 2, stdout: message, failed: false };
}

/**
 * Build the engine for one set of configured hooks.
 * @param {{hooks: object[], config: object, runners?: object, isMuted?: (agent: object) => boolean}} options
 *   `hooks` are the records from loadHookSettings. `runners` overrides the runner of a handler
 *   type (the types that need DSH, and tests). No hook runs for an agent that `isMuted` names.
 */
export function createHookEngine({ hooks: initial, config, runners, isMuted }) {
  let hooks = initial;
  const matchers = new Map();

  // One predicate per (event, matcher), built once. A pattern that does not parse is reported once.
  function matcherFor(hook) {
    const key = `${hook.event}\u0000${hook.matcher}`;
    if (!matchers.has(key)) {
      const predicate = compileMatcher(hook.matcher, { narrow: NARROW_EVENTS.has(hook.event) });
      if (predicate.invalid !== undefined) {
        console.warn(`dsh-claude-compat: ${hook.event} matcher /${hook.matcher}/ is not a valid regular expression (${predicate.invalid}); its hooks never run`);
      }
      matchers.set(key, predicate);
    }
    return matchers.get(key);
  }

  function eligible(event, spec) {
    return hooks.filter((hook) => {
      if (hook.event !== event || !matcherFor(hook)(spec.subject ?? '')) return false;
      if (hook.ifRule === undefined) return true;
      return spec.tool !== undefined && matchIfRule(hook.ifRule, spec.tool.name, spec.tool.input);
    });
  }

  // A hook's own timeout always wins. Claude Code lowers the default for some
  // events (`spec.defaultMs`). The model-backed types keep their own defaults.
  function timeoutFor(hook, spec) {
    if (hook.timeoutMs !== undefined) return hook.timeoutMs;
    if (hook.type in TYPE_TIMEOUT_MS) return TYPE_TIMEOUT_MS[hook.type];
    return spec.defaultMs ?? config.hooksTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  function runOne(hook, spec) {
    return runHandler(hook, JSON.stringify(spec.payload), {
      timeoutMs: timeoutFor(hook, spec),
      runners,
      event: hook.event,
      agent: spec.agent,
    });
  }

  // `async` hooks run in the background. They cannot change the decision, so
  // their failures are logged here. `asyncRewake` also reports exit 2.
  function runInBackground(hook, spec, claudeName) {
    runOne(hook, spec).then((run) => {
      if (run.failed) {
        console.warn(`dsh-claude-compat: async ${claudeName} hook failed, ${failureText(run, hook)}`);
      } else if (run.exitCode === 2 && hook.asyncRewake && spec.rewake !== undefined) {
        spec.rewake(run.stdout.trim());
      } else if (run.exitCode === 2) {
        console.warn(`dsh-claude-compat: async ${claudeName} hook exit 2 cannot block, ignored`);
      }
    });
  }

  return {
    has(event) {
      return hooks.some((hook) => hook.event === event);
    },

    /** The events that at least one hook uses. */
    events() {
      return new Set(hooks.map((hook) => hook.event));
    },

    /** The distinct matchers that the hooks of `event` use. */
    matchers(event) {
      return [...new Set(hooks.filter((hook) => hook.event === event).map((hook) => hook.matcher))];
    },

    /** Swap the configured hooks, for a settings file that changed while the session runs. */
    replace(next) {
      hooks = next;
    },

    /**
     * Run every hook for `event` that matches. Hooks run one after another in
     * config order.
     * @param {string} event internal event name
     * @param {string} claudeName Claude event name, for the logs and the output check
     * @param {{subject?: string, tool?: {name: string, input: unknown}, payload: object,
     *   agent?: object, defaultMs?: number, rewake?: Function}} spec what to match and what to
     *   send. `agent` is the agent that the event is about.
     * @returns {Promise<object>} merged outcome (see src/hook-output.js)
     */
    async fire(event, claudeName, spec) {
      // No hook runs in an agent that an agent hook started, so a hook cannot start itself again.
      if (spec.agent !== undefined && isMuted?.(spec.agent)) return mergeOutcomes([]);
      const outcomes = [];
      for (const hook of eligible(event, spec)) {
        if (hook.async) {
          runInBackground(hook, spec, claudeName);
          continue;
        }
        const run = await runOne(hook, spec);
        if (run.failed) console.warn(`dsh-claude-compat: ${claudeName} hook failed, ${failureText(run, hook)}`);
        outcomes.push(interpretRun(event, claudeName, applyOnFailure(run, hook, event)));
      }
      return mergeOutcomes(outcomes);
    },
  };
}

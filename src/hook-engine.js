// dsh-claude-compat: runs the hooks configured for one event and folds their
// results into one outcome. The DSH bridges (src/hook-bridge-*.js) call
// `engine.fire(...)` at a DSH extension point and map the outcome onto a DSH
// decision.

import { NO_ONFAILURE_EVENTS } from './hook-events.js';
import { runHandler } from './hook-handlers.js';
import { interpretRun, mergeOutcomes } from './hook-output.js';
import { matchIfRule } from './hook-spec.js';

// Compile a Claude Code hook matcher ("Bash", "Bash|Edit", ".*") into a
// predicate. Exact names match exactly; `*` / `.*` are wildcards; `|`
// alternates.
export function compileMatcher(matcher) {
  if (typeof matcher !== 'string') return () => false;
  const trimmed = matcher.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === '.*') return () => true;
  try {
    const pattern = trimmed
      .split('|')
      .map((part) => part.trim().split('*').join('.*'))
      .join('|');
    const re = new RegExp(`^(?:${pattern})$`);
    return (name) => re.test(name);
  } catch {
    return () => false;
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

// `onFailure: "block"` makes a failed hook behave like exit code 2.
function applyOnFailure(run, hook, event) {
  if (!run.failed || hook.onFailure !== 'block' || NO_ONFAILURE_EVENTS.has(event)) return run;
  const label = hook.command ?? hook.url ?? hook.tool ?? hook.type;
  return { exitCode: 2, stdout: `hook failed (${run.reason}): ${label}`, failed: false };
}

/**
 * Build the engine for one set of configured hooks.
 * @param {{hooks: object[], config: object, runners?: object}} options
 *   `hooks` are the records from loadHookSettings. `runners` overrides the
 *   runner of a handler type (the types that need DSH, and tests).
 */
export function createHookEngine({ hooks, config, runners }) {
  function eligible(event, spec) {
    return hooks.filter((hook) => {
      if (hook.event !== event || !compileMatcher(hook.matcher)(spec.subject ?? '')) return false;
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
    return runHandler(hook, JSON.stringify(spec.payload), { timeoutMs: timeoutFor(hook, spec), runners });
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

    /**
     * Run every hook for `event` that matches. Hooks run one after another in
     * config order.
     * @param {string} event internal event name
     * @param {string} claudeName Claude event name, for the logs and the output check
     * @param {{subject?: string, tool?: {name: string, input: unknown}, payload: object,
     *   defaultMs?: number, rewake?: Function}} spec what to match and what to send
     * @returns {Promise<object>} merged outcome (see src/hook-output.js)
     */
    async fire(event, claudeName, spec) {
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

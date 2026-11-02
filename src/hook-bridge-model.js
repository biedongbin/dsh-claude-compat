// dsh-claude-compat: PostModelSwitch.
//
// DSH has no event for a model change. Each step, `agent/pre-step` carries the
// model selection. When it differs from the one of the previous step, the model
// changed, and the hook runs before the step. Its context joins that step, which is
// the next request after the switch. PreModelSwitch has no DSH point, because DSH
// applies the model before any plugin can see it.

import { isSubagent, sessionIdOf } from './hook-support.js';

// DSH does not say who asked for a model change. A user command is the usual source.
const SWITCH_SOURCE = 'command';

function modelOf(selection) {
  return typeof selection?.model === 'string' ? selection.model : undefined;
}

async function onPreStep(engine, support, models, { agent, modelSelection }, next) {
  const model = modelOf(modelSelection);
  const key = sessionIdOf(agent);
  const previous = models.get(key);
  if (isSubagent(agent) || model === undefined) return next();
  models.set(key, model);
  if (previous === undefined || previous === model) return next();
  const outcome = await engine.fire('post-model-switch', 'PostModelSwitch', {
    subject: model,
    defaultMs: 30_000,
    agent,
    rewake: support.rewake(agent),
    payload: support.payload('PostModelSwitch', agent, {
      from_model: previous,
      to_model: model,
      requested_model: model,
      source: SWITCH_SOURCE,
    }),
  });
  const downstream = await next();
  const extra = support.contextMessages(outcome);
  if (extra.length === 0 || downstream.kind !== 'enter') return downstream;
  return { ...downstream, messages: [...downstream.messages, ...extra] };
}

/**
 * Register the model switch hook when the configured settings use it.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerModelHooks(ctx, engine, support) {
  if (!engine.has('post-model-switch')) return;
  const models = new Map();
  support.onForget((id) => models.delete(id));
  ctx.on('agent/pre-step', (payload, next) => onPreStep(engine, support, models, payload, next));
}

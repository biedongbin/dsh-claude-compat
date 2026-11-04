// dsh-claude-compat: PostModelSwitch.
//
// DSH has no event for a model change. Each request, `agent/request` resolves the call
// configuration, and `next()` returns it with the provider and model of that request. When the
// provider or the model differs from the previous request of the session, the model changed,
// and the hook runs before the request goes out. Its context joins the next step, because the
// messages of the current step are already built. PreModelSwitch has no DSH point, because
// DSH applies the model before any plugin can see it.

import { isSubagent, sessionIdOf } from './hook-support.js';

// DSH does not say who asked for a model change. A user command is the usual source.
const SWITCH_SOURCE = 'command';

function routeOf(config) {
  const { provider, model } = config ?? {};
  return typeof model === 'string' && model !== '' ? { provider: String(provider ?? ''), model } : undefined;
}

const keyOf = (route) => `${route.provider}/${route.model}`;

async function onRequest(engine, support, state, { agent }, next) {
  const config = await next();
  const route = routeOf(config);
  const key = sessionIdOf(agent);
  const previous = state.routes.get(key);
  if (isSubagent(agent) || route === undefined) return config;
  state.routes.set(key, route);
  if (previous === undefined || keyOf(previous) === keyOf(route)) return config;
  const outcome = await engine.fire('post-model-switch', 'PostModelSwitch', {
    subject: route.model,
    defaultMs: 30_000,
    agent,
    rewake: support.rewake(agent),
    payload: support.payload('PostModelSwitch', agent, {
      from_model: previous.model,
      to_model: route.model,
      from_provider: previous.provider,
      to_provider: route.provider,
      requested_model: route.model,
      source: SWITCH_SOURCE,
    }),
  });
  const extra = support.contextMessages(outcome);
  if (extra.length > 0) state.pending.set(key, [...state.pending.get(key) ?? [], ...extra]);
  return config;
}

async function onPreStep(state, support, { agent }, next) {
  const key = sessionIdOf(agent);
  const downstream = await next();
  const extra = state.pending.get(key);
  if (extra === undefined || downstream.kind !== 'enter') return downstream;
  state.pending.delete(key);
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
  const state = { routes: new Map(), pending: new Map() };
  support.onForget((id) => {
    state.routes.delete(id);
    state.pending.delete(id);
  });
  ctx.on('agent/request', (payload, next) => onRequest(engine, support, state, payload, next));
  ctx.on('agent/pre-step', (payload, next) => onPreStep(state, support, payload, next));
}

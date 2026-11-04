// dsh-claude-compat: TeammateIdle.
//
// The DSH agent team package writes a `team/member` event for each teammate. A
// teammate is idle when its agent status goes from running to idle. A hook that
// blocks keeps the teammate working: the bridge steers the teammate with the reason.

import { sessionIdOf } from './hook-support.js';

/**
 * Register the TeammateIdle hook when the configured settings use it.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerTeamHooks(ctx, engine, support) {
  if (!engine.has('teammate-idle')) return;
  const members = new Map();
  const running = new Set();
  support.onForget((id) => {
    running.delete(id);
    members.delete(id);
  });

  ctx.on('session/event', (_session, event) => {
    const member = event.type === 'team/member' ? event.data?.member : undefined;
    if (typeof member?.id === 'string') members.set(member.id, { name: member.name, teamId: event.data.teamId });
  });

  async function onIdle(agent, member) {
    const outcome = await engine.fire('teammate-idle', 'TeammateIdle', {
      agent,
      rewake: support.rewake(agent),
      payload: support.payload('TeammateIdle', agent, { teammate_name: member.name, team_name: member.teamId }),
    });
    if (!outcome.blocked) return;
    if (typeof agent.steer === 'function') agent.steer(support.contextMessage(outcome.reason ?? 'blocked by TeammateIdle hook'));
    else console.warn('dsh-claude-compat: a TeammateIdle hook asked the teammate to keep working, but it cannot be steered; ignored');
  }

  ctx.on('agent/status', ({ agent, status }) => {
    const key = sessionIdOf(agent);
    if (status === 'running') {
      running.add(key);
      return;
    }
    const wasRunning = running.delete(key);
    const member = members.get(key);
    if (wasRunning && member !== undefined) support.track(onIdle(agent, member));
  });
}

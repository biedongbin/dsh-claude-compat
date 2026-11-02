// dsh-claude-compat: MessageDisplay, and the text of the last assistant message
// that Stop and StopFailure hooks report.
//
// Both read DSH's `agent/assistant-stream` frames. MessageDisplay is observe-only:
// DSH has no point where a plugin can change the text that a client shows, so
// `displayContent` is ignored.

import { randomUUID } from 'node:crypto';
import { isSubagent, sessionIdOf } from './hook-support.js';

const DISPLAY_DEFAULT_MS = 10_000;

function freshMessage(previous, turn) {
  return {
    turn,
    turnId: previous?.turn === turn ? previous.turnId : randomUUID(),
    messageId: randomUUID(),
    text: '',
    pending: '',
    index: 0,
    queue: previous?.queue ?? Promise.resolve(),
  };
}

// The part of `text` up to and including its last newline, and the rest.
function splitLines(text) {
  const cut = text.lastIndexOf('\n') + 1;
  return [text.slice(0, cut), text.slice(cut)];
}

/**
 * Register the stream listener when a configured hook needs the message text.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 * @returns {{lastMessage: (agent: object) => string}} reader for the last message text
 */
export function registerMessageHooks(ctx, engine, support) {
  const wantsDisplay = engine.has('message-display');
  const wantsText = wantsDisplay || engine.has('stop') || engine.has('stop-failure');
  const messages = new Map();
  support.onForget((id) => messages.delete(id));
  let warnedDisplayContent = false;

  // Batches run one after another, so a hook sees the lines of a message in order.
  function display(agent, state, delta, final) {
    const payload = support.payload('MessageDisplay', agent, {
      turn_id: state.turnId,
      message_id: state.messageId,
      index: state.index,
      final,
      delta,
    });
    state.index += 1;
    state.queue = state.queue.then(async () => {
      const outcome = await engine.fire('message-display', 'MessageDisplay', { defaultMs: DISPLAY_DEFAULT_MS, payload });
      if (outcome.specific.displayContent !== undefined && !warnedDisplayContent) {
        warnedDisplayContent = true;
        console.warn('dsh-claude-compat: MessageDisplay hook returned displayContent; DSH cannot change displayed text, ignored');
      }
    });
    // One failed batch must not stop the batches after it.
    state.queue = state.queue.catch((error) => {
      console.warn(`dsh-claude-compat: MessageDisplay hooks failed: ${error?.message ?? error}`);
    });
    support.track(state.queue);
  }

  function onChunk(agent, state, chunk) {
    if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string') return;
    state.text += chunk.text;
    if (!wantsDisplay) return;
    const [lines, rest] = splitLines(state.pending + chunk.text);
    state.pending = rest;
    if (lines !== '') display(agent, state, lines, false);
  }

  if (wantsText) {
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (isSubagent(agent)) return;
      const key = sessionIdOf(agent);
      if (frame.type === 'start') {
        messages.set(key, freshMessage(messages.get(key), frame.turn));
        return;
      }
      const state = messages.get(key);
      if (state === undefined) return;
      if (frame.type === 'chunk') {
        onChunk(agent, state, frame.chunk);
      } else if (frame.type === 'end' && wantsDisplay && frame.outcome?.kind === 'committed' && state.text !== '') {
        display(agent, state, state.pending, true);
        state.pending = '';
      }
    });
  }

  return { lastMessage: (agent) => messages.get(sessionIdOf(agent))?.text ?? '' };
}

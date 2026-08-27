// v0.8.0 tests: session hook payload fidelity — the SessionStart/SessionEnd
// bridge must read the agent from the event dispatch. DSH agent events
// dispatch (carrier, name, payload); the agent may ride on the carrier
// (headless path) or be fused onto the payload (agent-loop path). Both are
// covered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionStartPayload, sessionEndPayload } from '../src/hooks.js';

const agent = {
  session: {
    id: 'session-test-123',
    header: { cwd: '/proj/sub' },
  },
};

test('session payload reads session id/cwd from the agent', () => {
  const start = JSON.parse(sessionStartPayload(agent));
  assert.equal(start.session_id, 'session-test-123');
  assert.equal(start.cwd, '/proj/sub');
  assert.equal(start.reason, undefined);

  const end = JSON.parse(sessionEndPayload(agent));
  assert.equal(end.session_id, 'session-test-123');
  assert.equal(end.cwd, '/proj/sub');
  assert.equal(end.reason, 'session_end');
});

test('session payload falls back to process cwd + unknown id when agent missing', () => {
  const fallbackStart = JSON.parse(sessionStartPayload(undefined));
  assert.equal(fallbackStart.session_id, 'unknown');
  assert.equal(fallbackStart.cwd, process.cwd());
});

// Mirrors the headless dispatch shape: agent rides on the carrier (1st arg).
test('headless dispatch: agent on carrier, payload undefined', () => {
  const carrier = { agent };
  const payload = undefined;
  const got = carrier?.agent ?? payload?.agent;
  assert.equal(got.session.id, 'session-test-123');
  assert.equal(JSON.parse(sessionStartPayload(got)).session_id, 'session-test-123');
});

// Mirrors the agent-loop dispatch shape: agent fused onto the payload.
test('agent-loop dispatch: agent on payload, carrier is routing object', () => {
  const carrier = { $$routing: true };
  const payload = { agent };
  const got = carrier?.agent ?? payload?.agent;
  assert.equal(got.session.id, 'session-test-123');
  assert.equal(JSON.parse(sessionEndPayload(got)).session_id, 'session-test-123');
});

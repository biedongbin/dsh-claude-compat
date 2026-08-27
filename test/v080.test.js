// v0.8.0 tests: session hook payload fidelity — the SessionStart/SessionEnd
// bridge must read the agent from the fused event payload, not the carrier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionStartPayload, sessionEndPayload } from '../src/hooks.js';

// Simulates the DSH agent event dispatch shape: (carrier, name, { ...payload, agent }).
function dispatch(payload, agent) {
  const carrier = { $$carrier: true }; // stateless routing object, NOT the agent
  const fused = { ...payload, agent };
  // RegisterHooks's listener is (carrier, name, { agent }); this mirrors how
  // the payload arrives when the listener destructures the 3rd argument.
  return { carrier, name: 'x', agent: fused.agent };
}

test('session payload reads session id/cwd from the fused agent, not the carrier', () => {
  const agent = {
    session: {
      id: 'session-test-123',
      header: { cwd: '/proj/sub' },
    },
  };
  const { carrier, agent: got } = dispatch({ source: 'test' }, agent);
  assert.notDeepEqual(carrier, agent, 'carrier must be distinct from agent');
  assert.equal(got.session.id, 'session-test-123');

  const start = JSON.parse(sessionStartPayload(got));
  assert.equal(start.session_id, 'session-test-123');
  assert.equal(start.cwd, '/proj/sub');
  assert.equal(start.reason, undefined);

  const end = JSON.parse(sessionEndPayload(got));
  assert.equal(end.session_id, 'session-test-123');
  assert.equal(end.cwd, '/proj/sub');
  assert.equal(end.reason, 'session_end');
});

test('session payload falls back to process cwd + unknown id when agent missing', () => {
  const fallbackStart = JSON.parse(sessionStartPayload(undefined));
  assert.equal(fallbackStart.session_id, 'unknown');
  assert.equal(fallbackStart.cwd, process.cwd());
});

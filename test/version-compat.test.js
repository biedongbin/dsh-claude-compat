// The plugin ships one code path for DSH 0.2.2-rc.1 and for the 0.2.1.x line,
// whose tool executor takes a single call instead of a batch. These tests pin
// the contract choice down without a DSH install: a batch executor is used as
// is, a single-call executor is detected from its rejection of `calls`, and a
// tool that fails is never run twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeToolCall } from '../src/compat.js';

const CALL = { type: 'tool-call', id: 'call-1', name: 'echo', arguments: '{"text":"hi"}' };

test('executeToolCall reads a batch result by callId', async () => {
  const seen = [];
  const tools = {
    execute: async (request) => {
      seen.push(request);
      return { results: [{ callId: request.calls[0].id, result: { content: [{ type: 'text', text: 'ok' }] } }] };
    },
  };
  const result = await executeToolCall(tools, CALL, { agent: { id: 'agent' } });
  assert.deepEqual(result, { content: [{ type: 'text', text: 'ok' }] });
  assert.equal(seen[0].calls[0].name, 'echo');
  assert.equal(seen[0].agent.id, 'agent');
});

test('executeToolCall retries the single-call contract once', async () => {
  const seen = [];
  const tools = {
    execute: async (request) => {
      seen.push(request);
      if (Array.isArray(request.calls)) throw new TypeError('Unknown field "calls"');
      return { content: [], isError: false };
    },
  };
  const result = await executeToolCall(tools, CALL);
  assert.equal(result.isError, false);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].callId, 'call-1');
  assert.equal(seen[1].name, 'echo');
  assert.equal(seen[1].arguments, '{"text":"hi"}');
});

test('executeToolCall does not repeat a call whose tool failed', async () => {
  let executions = 0;
  const tools = {
    execute: async () => {
      executions += 1;
      throw new TypeError('the tool threw');
    },
  };
  await assert.rejects(() => executeToolCall(tools, CALL), /the tool threw/);
  assert.equal(executions, 1);
});

test('executeToolCall reports a missing tool service', async () => {
  await assert.rejects(() => executeToolCall(undefined, CALL), /tool service is not available/);
});

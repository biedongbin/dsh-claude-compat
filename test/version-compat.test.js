// Pin the two supported tool contracts without executing a probe call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeToolCall } from '../src/compat.js';

const CALL = { type: 'tool-call', id: 'call-1', name: 'echo', arguments: '{"text":"hi"}' };
const batch = (execute) => ({ setExecutor() {}, execute });
const legacy = (execute) => ({ prepareExecution() {}, createExecution() {}, execute });

test('batch contract matches callId and preserves wire arguments, scope and signal', async () => {
  const options = { agent: { id: 'agent' }, signal: new AbortController().signal };
  let executions = 0;
  const result = { content: [{ type: 'text', text: 'ok' }] };
  const tools = batch(async (request) => {
    executions++;
    assert.deepEqual(request, { calls: [CALL], ...options });
    return { results: [{ callId: 'other', result: {} }, { callId: CALL.id, result }] };
  });
  assert.equal(await executeToolCall(tools, CALL, options), result);
  assert.equal(executions, 1);
});

test('legacy contract decodes JSON values and preserves callId, scope and signal', async () => {
  for (const value of [{ text: 'hi' }, ['hi', 1], null, 'text', 42, false]) {
    let executions = 0;
    const options = { agent: { id: 'agent' }, signal: new AbortController().signal };
    const result = { content: [], isError: false };
    const tools = legacy(async (request) => {
      executions++;
      assert.deepEqual(request, { callId: CALL.id, name: CALL.name, arguments: value, ...options });
      return result;
    });
    assert.equal(await executeToolCall(tools, { ...CALL, arguments: JSON.stringify(value) }, options), result);
    assert.equal(executions, 1);
  }
});

for (const [name, factory] of [['batch', batch], ['legacy', legacy]]) {
  test(`${name}: thrown errors mentioning calls never trigger a retry`, async () => {
    let executions = 0;
    const error = new TypeError('the tool failed while processing calls');
    const tools = factory(async () => { executions++; throw error; });
    await assert.rejects(() => executeToolCall(tools, CALL), (caught) => caught === error);
    assert.equal(executions, 1);
  });

  test(`${name}: materialized failures never trigger a retry`, async () => {
    let executions = 0;
    const result = { isError: true, content: [{ type: 'text', text: 'failed calls' }] };
    const tools = factory(async () => {
      executions++;
      return name === 'batch' ? { results: [{ callId: CALL.id, result }] } : result;
    });
    assert.equal(await executeToolCall(tools, CALL), result);
    assert.equal(executions, 1);
  });

  test(`${name}: cancellation keeps the original signal and never retries`, async () => {
    let executions = 0;
    const controller = new AbortController();
    controller.abort(new Error('cancelled calls'));
    const tools = factory(async (request) => {
      executions++;
      assert.equal(request.signal, controller.signal);
      request.signal.throwIfAborted();
    });
    await assert.rejects(() => executeToolCall(tools, CALL, { signal: controller.signal }), /cancelled calls/);
    assert.equal(executions, 1);
  });
}

test('legacy malformed JSON is rejected before dispatch', async () => {
  let executions = 0;
  await assert.rejects(() => executeToolCall(legacy(async () => { executions++; }), { ...CALL, arguments: '{' }), SyntaxError);
  assert.equal(executions, 0);
});

test('batch result without this callId does not dispatch another call', async () => {
  let executions = 0;
  assert.equal(await executeToolCall(batch(async () => {
    executions++;
    return { results: [{ callId: 'other', result: {} }] };
  }), CALL), undefined);
  assert.equal(executions, 1);
});

test('unknown executors are rejected without a probe execution', async () => {
  let executions = 0;
  await assert.rejects(() => executeToolCall({ execute: async () => { executions++; } }, CALL), /unsupported DSH tool executor/);
  assert.equal(executions, 0);
});

test('missing tool services are reported', async () => {
  for (const tools of [undefined, null, {}]) {
    await assert.rejects(() => executeToolCall(tools, CALL), /tool service is not available/);
  }
});

test('manifest and lockfile explicitly support the two tested DSH releases', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  const range = '0.2.1-rc.2 || 0.2.2-rc.1';
  assert.equal(manifest.engines.dsh, range);
  assert.equal(lock.packages[''].engines.dsh, range);
  for (const name of ['dsh-session', 'dsh-sandbox', 'dsh-client-connection']) {
    assert.equal(manifest.peerDependencies[`@deepseek-ai/${name}`], range);
    assert.equal(lock.packages[''].peerDependencies[`@deepseek-ai/${name}`], range);
  }
});

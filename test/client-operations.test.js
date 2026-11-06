import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clientHarness, deferred, historyMetadata, text } from './client-kit.js';

const update = (name) => ({ action: 'plugins.update', target: `${name}@catalog`, cwd: '/fixture-project' });
function historyFixture(items, overrides = {}) {
  return {
    listProjects: async () => ({ items: [] }),
    listSessions: async ({ limit = 10, offset = 0 }) => ({ items: items.slice(offset, offset + limit), total: items.length, hasMore: offset + limit < items.length }),
    preview: async ({ sessionId }) => ({ text: `Preview of ${sessionId}` }),
    prepareHandoff: async ({ sessionId, cwd }) => historyMetadata({ cwd, id: sessionId,
      sourcePath: `${cwd}/.claude/${sessionId}.jsonl`, title: `History ${sessionId}`,
      sizeBytes: 4096, warnings: [] }),
    importSession: async () => { throw new Error('Resume controls must never use the legacy archive importer'); },
    ...overrides,
  };
}
function handoffHost(admit = async () => ({ accepted: true })) {
  const calls = { workspaces: [], creates: [], prompts: [], directories: [] };
  const workspaceIds = new Map();
  return { calls, services: {
    workspaceRegistry: { create: async (path) => {
      calls.workspaces.push(path);
      if (!workspaceIds.has(path)) workspaceIds.set(path, `workspace-${workspaceIds.size + 1}`);
      return { id: workspaceIds.get(path), path };
    } },
    sessionController: {
      create: async (request) => { calls.creates.push(structuredClone(request)); return { sessionId: `ordinary-${calls.creates.length}` }; },
      prompt: async (request, signal) => { calls.prompts.push({ request: structuredClone(request), signal }); return admit(request, signal); },
    },
    workingDirectory: { set: (...args) => calls.directories.push(args) },
  } };
}
function assertTextPrompt(prompt, sourceId) {
  assert.equal(prompt.mode, 'queue');
  assert.equal(prompt.content.length, 1);
  assert.equal(prompt.content[0].type, 'text');
  assert.equal(typeof prompt.content[0].text, 'string');
  const request = prompt.content[0].text;
  assert.ok(request.includes(`${sourceId}.jsonl`), 'the selected source file is referenced');
  assert.match(request, /背景、当前任务状态和下一步计划/);
  assert.doesNotMatch(request, /Fixture plain history for|继续处理明确的待办|请接手并继续/);
  assert.ok(request.length < 1024);
  assert.deepEqual(Object.keys(prompt.content[0]).sort(), ['text', 'type']);
}
const historyRow = (id, title, extra = {}) => ({ id, title, messages: 1, updatedAt: 1, ...extra });
function pageSelector(h) {
  const found = h.root().findAll((node) => node.type === 'select' && node.props['aria-label'] === 'Items per page');
  assert.equal(found.length, 1, 'one accessible page-size selector for the visible list');
  return found[0];
}

test('updating A leaves B/C usable and accepts consecutive independent updates', async (t) => {
  const h = await clientHarness(t);
  await h.render();
  await h.click(h.button(h.row('A'), 'Update'));
  assert.equal(h.button(h.row('A'), 'Update').props.disabled, true);
  assert.ok(h.states('A').includes('Queued'), 'the start receipt is visible before the deferred adapter runs');
  assert.equal(h.button(h.row('B'), 'Update').props.disabled, false);
  assert.equal(h.button(h.row('C'), 'Update').props.disabled, false);

  await h.click(h.button(h.row('B'), 'Update'));
  assert.equal(h.button(h.row('B'), 'Update').props.disabled, true);
  assert.ok(h.states('B').includes('Queued'));
  assert.equal(h.button(h.row('C'), 'Update').props.disabled, false);
  await h.click(h.button(h.row('C'), 'Update'));
  assert.equal(h.button(h.row('C'), 'Update').props.disabled, true);
  assert.deepEqual(h.backend.mutations.map((request) => request.target), ['A@catalog', 'B@catalog', 'C@catalog']);
  const submissions = h.reads('operation.start');
  assert.equal(submissions.length, 3);
  assert.equal(new Set(submissions.map((request) => request.id)).size, 3);
  for (const submission of submissions) assert.match(submission.id, /^[a-f\d-]{36}$/i);
  await h.advance(5000);
  assert.ok(h.states('A').includes('Running'), 'polling advances the accepted receipt to its running status');
  assert.ok(h.states('B').includes('Queued'));
  assert.ok(h.states('C').includes('Queued'));
});

test('cancelling A does not cancel B, and B failure is displayed only on B', async (t) => {
  const h = await clientHarness(t);
  await h.render();
  await h.click(h.button(h.row('A'), 'Update'));
  await h.click(h.button(h.row('B'), 'Update'));
  await h.click(h.button(h.row('A'), 'Cancel A@catalog'));
  assert.ok(h.states('A').includes('Cancelled'));
  assert.equal(h.button(h.row('A'), 'Update').props.disabled, false);
  assert.equal(h.backend.mutations.find((request) => request.target === 'A@catalog').signal.aborted, true);
  assert.equal(h.backend.mutations.find((request) => request.target === 'B@catalog').signal.aborted, false);
  assert.equal(h.button(h.row('B'), 'Update').props.disabled, true);
  assert.equal(h.button(h.row('C'), 'Update').props.disabled, false);
  const aSubmission = h.reads('operation.start').find((request) => request.request.target === 'A@catalog');
  assert.deepEqual(h.reads('operation.cancel').map((request) => request.id), [aSubmission.id]);

  h.backend.complete('B@catalog', { ok: false, error: 'B update could not download its package' });
  await h.flush();
  await h.advance(5000);
  assert.ok(h.states('B').includes('Operation failed'));
  assert.equal(h.button(h.row('B'), 'Update').props.disabled, false);
  assert.deepEqual(h.alerts('B'), ['B update could not download its package']);
  assert.deepEqual(h.alerts('A'), []);
  assert.deepEqual(h.alerts('C'), []);
});

test('multiple restored tasks remain visible and a stale snapshot cannot erase a newer task', async (t) => {
  const oldResponse = deferred();
  let captured;
  const h = await clientHarness(t, { rpc: async ({ payload, ordinal, next }) => {
    const value = await next();
    if (payload.action === 'operation.list' && ordinal === 2) {
      captured = value;
      return oldResponse.promise;
    }
    return value;
  } });
  await h.backend.service.call({ action: 'operation.start', id: randomUUID(), request: update('A') });
  await h.backend.service.call({ action: 'operation.start', id: randomUUID(), request: update('B') });
  await h.render();
  assert.ok(h.states('A').includes('Running'));
  assert.ok(h.states('B').includes('Queued'));
  assert.equal(h.button(h.row('A'), 'Update').props.disabled, true);
  assert.equal(h.button(h.row('B'), 'Update').props.disabled, true);
  assert.equal(h.button(h.row('C'), 'Update').props.disabled, false);

  await h.advance(700);
  assert.ok(captured, 'the earlier poll is held at the RPC boundary');
  await h.click(h.button(h.row('C'), 'Update'));
  assert.ok(h.states('C').includes('Queued'));
  oldResponse.resolve(captured);
  await h.flush();
  assert.equal(h.button(h.row('C'), 'Update').props.disabled, true, 'older snapshot must not re-enable a new active row');
  assert.ok(h.states('C').includes('Queued'));
  assert.ok(h.states('A').includes('Running'));
  assert.ok(h.states('B').includes('Queued'));
  await h.advance(700);
  assert.equal(h.backend.mutations.length, 3);
});

test('a newer background handoff prevents an earlier refresh from stealing navigation', async (t) => {
  const admissionA = deferred(), admissionB = deferred(), refreshA = deferred(), refreshB = deferred();
  const opened = []; let refreshes = 0;
  t.after(() => { refreshA.resolve(); refreshB.resolve(); admissionA.resolve({ accepted: true }); admissionB.resolve({ accepted: true }); });
  const host = handoffHost((request, signal) => new Promise((resolve, reject) => {
    const gate = request.sessionId === 'ordinary-1' ? admissionA : admissionB;
    const abort = () => reject(new Error('fixture handoff cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    gate.promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); });
  }));
  const h = await clientHarness(t, {
    hostServices: host.services,
    services: {
      sessions: { refresh: () => (++refreshes === 1 ? refreshA.promise : refreshB.promise) },
      uiWorkspace: { openSession: (id) => opened.push(id) },
    },
    sessionService: historyFixture([historyRow('session-a', 'History A'), historyRow('session-b', 'History B')]),
  });
  await h.render(); await h.click(h.button(h.root(), 'Sessions'));
  await h.click(h.button(h.row('History A'), 'Quick resume'));
  assert.deepEqual(opened, [], 'prompt admission has not yet been accepted');
  admissionA.resolve({ accepted: true }); await h.flush(); await h.advance(5000);
  assert.equal(refreshes, 1, 'A is waiting for the Client inventory refresh after admission');
  await h.click(h.button(h.row('History B'), 'Quick resume'));
  assert.equal(host.calls.creates.length, 2);
  refreshA.resolve(); await h.flush();
  assert.deepEqual(opened, [], 'A cannot navigate after B becomes the latest local handoff');
  admissionB.resolve({ accepted: true }); await h.flush(); await h.advance(5000);
  assert.equal(refreshes, 2);
  refreshB.resolve(); await h.flush();
  assert.deepEqual(opened, ['ordinary-2']);
  assert.deepEqual(h.reads('operation.start').map(({ request }) => request.action), ['sessions.resume', 'sessions.resume']);
});

test('a task completed before its start response refreshes the list exactly once', async (t) => {
  const h = await clientHarness(t, { immediate: true, rpc: async ({ payload, next, backend }) => {
    const value = await next();
    if (payload.action !== 'operation.start') return value;
    // A fast real operation can be terminal by the time the receipt reaches the client.
    for (let count = 0; count < 20; count++) {
      const latest = await backend.service.call({ action: 'operation.status', id: value.id });
      if (latest.state === 'done') return latest;
    }
    throw new Error('fixture fast operation did not settle');
  } });
  await h.render();
  assert.equal(h.reads('plugins.list').length, 1);
  await h.click(h.button(h.row('A'), 'Update'));
  assert.ok(h.states('A').includes('Completed'));
  assert.equal(h.button(h.row('A'), 'Update').props.disabled, false);
  assert.equal(h.backend.invalidations, 1);
  assert.equal(h.reads('plugins.list').length, 2, 'successful completion refreshes the visible inventory');
  await h.advance(5000);
  await h.advance(5000);
  assert.equal(h.reads('plugins.list').length, 2, 'repeated terminal snapshots do not refresh it again');
  assert.equal(h.backend.mutations.length, 1);
});

test('a fast external task first seen as completed refreshes this manager once', async (t) => {
  const h = await clientHarness(t, { immediate: true });
  await h.render();
  assert.equal(h.reads('plugins.list').length, 1);
  assert.equal(h.reads('operation.list').length, 1, 'the manager has observed its initial empty snapshot');
  const started = await h.backend.service.call({ action: 'operation.start', id: randomUUID(), request: update('A') });
  let terminal;
  for (let count = 0; count < 20; count++) {
    terminal = await h.backend.service.call({ action: 'operation.status', id: started.id });
    if (terminal.state === 'done') break;
  }
  assert.equal(terminal.state, 'done');
  assert.equal(h.reads('operation.start').length, 0, 'this manager did not initiate or watch the external task');
  assert.deepEqual(h.states('A'), [], 'the completion has not reached this manager yet');
  await h.advance(5000);
  assert.ok(h.states('A').includes('Completed'));
  assert.equal(h.reads('plugins.list').length, 2, 'a newly observed external completion refreshes the inventory');
  await h.advance(5000);
  await h.advance(5000);
  assert.equal(h.reads('plugins.list').length, 2, 'later snapshots of that completion do not refresh again');
  assert.equal(h.backend.mutations.length, 1);
});

test('page size defaults to ten, stays shared across tabs and resets offsets', async (t) => {
  const numbered = (prefix) => Array.from({ length: 115 }, (_, index) => ({ name: `${prefix}${String(index + 1).padStart(3, '0')}`, enabled: true }));
  const sessions = numbered('H').map((item, index) => historyRow(`history-${index}`, item.name));
  const h = await clientHarness(t, { pluginItems: numbered('P'), marketplaceItems: numbered('M'), sessionService: historyFixture(sessions) });
  const page = (action, limit, offset, count = limit) => {
    const last = h.reads(action).at(-1);
    assert.equal(last.limit, limit); assert.equal(last.offset, offset);
    assert.equal(h.rows().length, count);
    assert.equal(Number(pageSelector(h).props.value), limit);
  };
  await h.render();
  page('plugins.list', 10, 0);
  assert.deepEqual(pageSelector(h).findAllByType('option').map((option) => String(option.props.value)), ['10', '20', '50', '100']);
  await h.click(h.button(h.root(), 'Marketplaces')); page('plugins.marketplace-list', 10, 0);
  await h.click(h.button(h.root(), 'Sessions')); page('sessions.list', 10, 0);
  await h.click(h.button(h.root(), 'Installed plugins'));
  await h.change(pageSelector(h), '20'); page('plugins.list', 20, 0);
  await h.click(h.button(h.root(), 'Next page')); page('plugins.list', 20, 20); h.row('P021');
  await h.change(pageSelector(h), '50'); page('plugins.list', 50, 0);
  await h.click(h.button(h.root(), 'Next page')); page('plugins.list', 50, 50); h.row('P051');
  await h.change(pageSelector(h), '100'); page('plugins.list', 100, 0);
  await h.click(h.button(h.root(), 'Next page')); page('plugins.list', 100, 100, 15); h.row('P101');
  await h.click(h.button(h.root(), 'Marketplaces')); page('plugins.marketplace-list', 100, 0);
  await h.change(pageSelector(h), '20'); page('plugins.marketplace-list', 20, 0);
  await h.click(h.button(h.root(), 'Next page')); page('plugins.marketplace-list', 20, 20); h.row('M021');
  await h.click(h.button(h.root(), 'Sessions')); page('sessions.list', 20, 0);
  await h.click(h.button(h.root(), 'Next page')); page('sessions.list', 20, 20); h.row('H021');
  await h.change(pageSelector(h), '10'); page('sessions.list', 10, 0);
  await h.click(h.button(h.root(), 'Next page')); page('sessions.list', 10, 10); h.row('H011');
  await h.click(h.button(h.root(), 'Installed plugins')); page('plugins.list', 10, 0);
});

test('install and add-marketplace forms submit distinct targets while another item runs', async (t) => {
  const h = await clientHarness(t);
  await h.render();
  await h.click(h.button(h.row('A'), 'Update'));
  await h.submitInput('Plugin name@marketplace', 'new@catalog');
  await h.click(h.button(h.root(), 'Marketplaces'));
  await h.submitInput('Marketplace repository, URL or directory', 'owner/repo');
  assert.deepEqual(h.reads('operation.start').map(({ request }) => [request.action, request.target]), [
    ['plugins.update', 'A@catalog'], ['plugins.install', 'new@catalog'], ['plugins.marketplace-add', 'owner/repo'],
  ]);
  assert.deepEqual(h.backend.mutations.map((request) => [request.action, request.target]), [
    ['update', 'A@catalog'], ['install', 'new@catalog'], ['marketplace-add', 'owner/repo'],
  ]);
  assert.equal(h.backend.mutations[0].signal.aborted, false);
});

test('history preview expands within its row, exposes loading and retry, and collapses', async (t) => {
  const first = deferred(); let previews = 0;
  t.after(() => first.resolve({ text: 'cleanup' }));
  const h = await clientHarness(t, { sessionService: historyFixture([
    historyRow('a', 'History A'), historyRow('b', 'History B'),
  ], { preview: () => ++previews === 1 ? first.promise : Promise.resolve({ text: 'Inline preview fixture body' }) }) });
  await h.render(); await h.click(h.button(h.root(), 'Sessions'));
  assert.equal(h.reads('sessions.preview').length, 0);
  await h.click(h.button(h.row('History A'), 'Preview'));
  assert.ok(h.row('History A').findAll((node) => node.props.role === 'status').some((node) => /loading/i.test(text(node))));
  first.reject(new Error('Preview fixture could not load'));
  await h.flush();
  assert.ok(h.alerts('History A').some((value) => value.includes('Preview fixture could not load')));
  assert.deepEqual(h.alerts('History B'), []);
  await h.click(h.button(h.row('History A'), 'Retry'));
  assert.equal(h.reads('sessions.preview').length, 2);
  assert.match(text(h.row('History A').findByType('pre')), /Inline preview fixture body/);
  assert.equal(h.row('History B').findAllByType('pre').length, 0);
  await h.click(h.button(h.row('History A'), 'Collapse preview'));
  assert.equal(h.row('History A').findAllByType('pre').length, 0);
  assert.equal(h.button(h.row('History A'), 'Preview').props.disabled, undefined);
});

test('page quick resume creates ordinary source-project sessions regardless of legacy archive markers', async (t) => {
  const opened = [], host = handoffHost();
  const h = await clientHarness(t, {
    initialCwd: '/source-project',
    status: { cwd: '/current-dsh-project', sessionId: 'status-current-decoy' },
    hostServices: host.services,
    services: { sessions: { refresh: async () => {} }, uiWorkspace: { openSession: (id) => opened.push(id) } },
    sessionService: historyFixture([
      historyRow('a', 'History A', { importedSessionId: 'legacy-archive-a', importStatus: 'complete' }),
      historyRow('b', 'History B'),
      historyRow('c', 'History C', { importedSessionId: 'partial-archive-c', importStatus: 'incomplete' }),
    ]),
  });
  await h.render(); await h.click(h.button(h.root(), 'Sessions'));
  assert.match(text(h.root()), /Continue in a new DSH conversation in the source project/);
  for (const title of ['History A', 'History B', 'History C']) {
    await h.click(h.button(h.row(title), 'Quick resume'));
    await h.advance(5000);
  }
  assert.deepEqual(opened, ['ordinary-1', 'ordinary-2', 'ordinary-3']);
  assert.deepEqual(host.calls.workspaces, ['/source-project', '/source-project', '/source-project']);
  assert.equal(host.calls.creates.length, 3);
  for (const created of host.calls.creates) assert.deepEqual(created, { workspaceId: 'workspace-1' });
  const requests = h.reads('operation.start');
  assert.deepEqual(requests.map(({ request }) => request.action), ['sessions.resume', 'sessions.resume', 'sessions.resume']);
  requests.forEach(({ request, id }, index) => {
    assert.equal(request.cwd, '/source-project');
    assert.equal('targetSessionId' in request, false, 'a page never derives its destination from status/session metadata');
    assert.equal('newSnapshot' in request, false);
    assert.equal(host.calls.prompts[index].request.requestId, id);
    assert.equal(host.calls.prompts[index].request.sessionId, `ordinary-${index + 1}`);
    assertTextPrompt(host.calls.prompts[index].request, ['a', 'b', 'c'][index]);
  });
  assert.equal(h.reads('sessions.preview').length, 0, 'one-click continuation does not require preview');
});

test('advanced context continuation sends its selected range without archive controls', async (t) => {
  const host = handoffHost(), opened = [];
  const h = await clientHarness(t, {
    hostServices: host.services,
    services: { sessions: { refresh: async () => {} }, uiWorkspace: { openSession: (id) => opened.push(id) } },
    sessionService: historyFixture([historyRow('a', 'History A', { importedSessionId: 'legacy-archive', importStatus: 'incomplete' })]),
  });
  await h.render(); await h.click(h.button(h.root(), 'Sessions'));
  await h.click(h.button(h.row('History A'), 'Preview'));
  const row = h.row('History A');
  assert.equal(row.findAll((node) => node.type === 'input' && node.props.type === 'checkbox').length, 0, 'context handoff has no archive snapshot checkbox');
  assert.equal(row.findAll((node) => node.type === 'button' && text(node) === 'Open in DSH').length, 0, 'legacy archive is not offered as the continuation');
  await h.change(row.findByType('select'), '50');
  await h.click(h.button(h.row('History A'), 'Read history and summarize'));
  await h.advance(5000);
  const request = h.reads('operation.start')[0].request;
  assert.equal(request.action, 'sessions.resume'); assert.equal(request.limitTurns, 50);
  assert.equal('newSnapshot' in request, false);
  assertTextPrompt(host.calls.prompts[0].request, 'a');
  assert.match(host.calls.prompts[0].request.content[0].text, /最近\s*50\s*轮/);
  assert.deepEqual(opened, ['ordinary-1']);
});

test('cc-resume command hands text to its current session without creation, navigation or directory changes', async (t) => {
  const admission = deferred(), opened = []; let refreshes = 0, navigation = 0, selected = 'current-A';
  t.after(() => admission.resolve({ accepted: true }));
  const host = handoffHost((_request, signal) => new Promise((resolve, reject) => {
    const abort = () => reject(new Error('fixture handoff cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    admission.promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); });
  }));
  const h = await clientHarness(t, {
    status: { cwd: '/different-current-project', sessionId: 'status-current-decoy' },
    hostServices: host.services,
    services: {
      sessions: { refresh: async () => { refreshes++; } },
      layout: { beginNavigation: () => { navigation++; return new AbortController().signal; } },
      uiWorkspace: { openSession: (id) => { opened.push(id); selected = id; } },
    },
    sessionService: historyFixture([historyRow('claude-a', 'History A', { importedSessionId: 'legacy-archive', importStatus: 'incomplete' })]),
  });
  await h.render({ sessionId: 'current-A', cwd: '/source-project' });
  assert.match(text(h.root()), /Continue in this DSH conversation/);
  await h.click(h.button(h.row('History A'), 'Quick resume'));
  const request = h.reads('operation.start')[0];
  assert.equal(request.request.action, 'sessions.resume');
  assert.equal(request.request.targetSessionId, 'current-A');
  assert.equal(request.request.sessionId, 'claude-a');
  assert.equal(request.request.cwd, '/source-project');
  assert.equal(host.calls.prompts[0].request.sessionId, 'current-A');
  assert.equal(host.calls.prompts[0].request.requestId, request.id);
  assertTextPrompt(host.calls.prompts[0].request, 'claude-a');
  selected = 'user-chosen-other-session';
  admission.resolve({ accepted: true }); await h.flush(); await h.advance(5000);
  assert.ok(h.states('History A').includes('Reading request sent to DSH'));
  assert.deepEqual(host.calls.creates, []); assert.deepEqual(host.calls.workspaces, []); assert.deepEqual(host.calls.directories, []);
  assert.deepEqual(opened, []); assert.equal(selected, 'user-chosen-other-session');
  assert.equal(refreshes, 0); assert.equal(navigation, 0);
  assert.equal(h.reads('sessions.preview').length, 0);
});

// Model native blank-session gating with real React/public projection subscriptions.
// Command renderers are deliberately absent until a normal Conversation becomes active.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react-test-renderer';
import { clientHarness, historyMetadata, text } from './client-kit.js';

const managed = ['cc-resume', 'cc-plugin', 'cc-export', 'reload-cc-plugins', 'reload-skills'];
function observable(value) {
  let snapshot = value;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    set(next) { snapshot = next; for (const callback of [...listeners]) callback(); },
    subscribers: () => listeners.size,
  };
}
class MutableNodes {
  #entries = new Map();
  #values;
  order = [];
  put(wrapper) {
    const id = wrapper.data.commandId ?? wrapper.id;
    if (!this.#entries.has(id)) this.order = [...this.order, id];
    this.#entries.set(id, wrapper);
    this.#values = undefined;
  }
  values() { return this.#values ??= this.order.map((id) => this.#entries.get(id)); }
}
function projectionScope(sessionId) {
  const nodes = new MutableNodes();
  return {
    session: observable({ sessionId, blank: true, running: false, promptAttempted: false }),
    conversation: observable({ activeTargets: new Map() }),
    chat: observable({ nodes }),
    nodes,
  };
}
function useSelected(store, selector) {
  // Selection happens at the subscription boundary, as public Harness hooks do.
  // Returning the stable nodes container/order would miss outcome-only changes.
  const getSnapshot = React.useCallback(() => selector(store.getSnapshot()), [store, selector]);
  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
function projectedCommand(name, commandId, outcome, options = {}) {
  return { kind: 'command', id: `command:${commandId}`, data: {
    seq: options.seq ?? 1, time: options.time ?? Date.now() - 120_000,
    commandId, name, args: '', ...(outcome === undefined ? {} : { outcome }),
  } };
}
const managerOutcome = (name, cwd = '/source-project') => ({ kind: 'success', text: JSON.stringify({
  ui: 'claude-compat', mode: name === 'cc-resume' ? 'sessions' : 'plugins', cwd,
}) });
function visibleText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || node.props?.hidden || node.props?.style?.display === 'none') return '';
  const children = node.type === 'details' && node.props.open !== true
    ? node.children.filter((child) => typeof child !== 'string' && child.type === 'summary')
    : node.children ?? [];
  return children.map(visibleText).join('');
}
async function blankHarness(t, options = {}) {
  const prompts = [], creates = [];
  const h = await clientHarness(t, {
    hostServices: {
      sessionController: {
        create: async (request) => { creates.push(request); return { sessionId: 'unexpected-new-session' }; },
        prompt: async (request) => { prompts.push(structuredClone(request)); return { accepted: true }; },
      },
    },
    sessionService: {
      listProjects: async () => ({ items: [] }),
      listSessions: async () => ({ items: [{ id: 'history-fixture', title: 'History fixture', messages: 1 }], total: 1, hasMore: false }),
      prepareHandoff: async ({ cwd, sessionId }) => historyMetadata({
        cwd, id: sessionId, sourcePath: `${cwd}/history-fixture.jsonl`, sizeBytes: 4096, warnings: [],
      }),
      importSession: async () => { throw new Error('a command dock must not import synthetic history'); },
    },
    ...options,
  });
  const Dock = h.slot('conversation.input.dock', 'claude-compat-commands');
  assert.equal(typeof Dock, 'function', 'blank conversations have an additive, always-resident command dock');
  const scopes = new Map();
  const scope = (id) => {
    if (!scopes.has(id)) scopes.set(id, projectionScope(id));
    return scopes.get(id);
  };
  function NativeTimeline({ current, sessionId, hooks }) {
    const wrappers = useSelected(current.chat, (value) => value.nodes.values());
    return React.createElement('div', { 'data-native-timeline': true }, wrappers
      .filter((wrapper) => wrapper.kind === 'command' && managed.includes(wrapper.data.name))
      .map((wrapper) => {
        const View = h.slot('conversation.chat.commandview', wrapper.data.name);
        assert.equal(typeof View, 'function', `${wrapper.data.name} has a normal command slot`);
        return React.createElement(View, { key: `${sessionId}:${wrapper.data.commandId}`, sessionId, node: wrapper.data, ...hooks });
      }));
  }
  function NativeConversationShell({ sessionId }) {
    const current = scope(sessionId);
    const session = useSelected(current.session, (value) => value);
    const targets = useSelected(current.conversation, (value) => value.activeTargets.size);
    // While the native Timeline is absent, only the dock observes command changes.
    // Stable owner hooks keep a wrong nodes/order selector from being rescued by
    // an unrelated parent re-render when only the command outcome changes.
    const hooks = React.useMemo(() => ({
      useChat: (selector) => useSelected(current.chat, selector),
      useConversation: (selector) => useSelected(current.conversation, selector),
      useSession: (selector) => useSelected(current.session, selector),
    }), [current]);
    const activeView = targets > 0 || session.running || session.promptAttempted;
    const omitTimeline = session.blank && !activeView;
    return React.createElement('main', null,
      React.createElement('div', { 'data-native-input-dock': true }, React.createElement(Dock, {
        sessionId, session, input: { text: '', attachments: [] }, ...hooks,
      })),
      !omitTimeline && React.createElement(NativeTimeline, { current, sessionId, hooks }));
  }
  const shell = (sessionId) => React.createElement(NativeConversationShell, { sessionId });
  async function publish(id, wrapper) {
    await act(async () => {
      const current = scope(id);
      current.nodes.put(wrapper);
      current.chat.set({ nodes: current.nodes });
    });
    await h.flush();
  }
  async function phase(id, change = {}, activeTargets) {
    await act(async () => {
      const current = scope(id);
      current.session.set({ ...current.session.getSnapshot(), ...change });
      if (activeTargets) current.conversation.set({ activeTargets });
    });
    await h.flush();
  }
  const cards = () => h.root().findAll((node) => node.type === 'div'
    && String(node.props.className).split(' ').includes('dcc-card'));
  return { ...h, prompts, creates, scope, publish, phase, cards,
    visible: () => visibleText(h.root()),
    start: async (id = 'current-A') => h.mount(shell(id)),
    switchSession: async (id) => h.updateTree(shell(id)),
    timelines: () => h.root().findAll((node) => node.props['data-native-timeline'] === true),
    docks: () => h.root().findAll((node) => node.props['data-native-input-dock'] === true),
  };
}

test('a first cc-resume run becomes a visible current-session manager without a normal timeline', async (t) => {
  const h = await blankHarness(t);
  await h.start();
  assert.equal(h.timelines().length, 0);
  assert.equal(h.docks().length, 1);
  assert.equal(h.cards().length, 0);
  assert.equal(h.requests.length, 0, 'an empty dock must not eagerly mount a manager');
  await h.publish('current-A', projectedCommand('cc-resume', 'first'));
  assert.equal(h.cards().length, 1);
  assert.match(h.visible(), /Loading/);
  assert.equal(h.timelines().length, 0, 'a command alone does not activate the native chat view');
  const nodes = h.scope('current-A').nodes, order = nodes.order;
  await h.publish('current-A', projectedCommand('cc-resume', 'first', managerOutcome('cc-resume')));
  assert.equal(h.scope('current-A').nodes, nodes);
  assert.equal(nodes.order, order, 'run to done leaves the native node container and order unchanged');
  assert.equal(h.timelines().length, 0);
  assert.match(h.visible(), /History fixture/);
  assert.match(h.visible(), /Continue in this DSH conversation/);
  assert.equal(h.reads('status').at(-1).sessionId, 'current-A');
  assert.equal(h.reads('sessions.list').at(-1).cwd, '/source-project');
  assert.equal(h.reads('operation.start').length, 0, 'showing the first command never prompts a model or creates a user turn');
  assert.equal(h.prompts.length, 0);
  await h.click(h.button(h.row('History fixture'), 'Quick resume'));
  await h.advance(5000);
  assert.equal(h.reads('operation.start')[0].request.targetSessionId, 'current-A');
  assert.equal(h.prompts[0].sessionId, 'current-A');
  assert.match(h.prompts[0].content[0].text, /history-fixture\.jsonl/);
  assert.match(h.prompts[0].content[0].text, /背景、当前任务状态和下一步计划/);
  assert.ok(h.prompts[0].content[0].text.length < 1024);
  assert.equal(h.creates.length, 0);
});

test('the first cc-plugin command also exposes its manager while the session is blank', async (t) => {
  const h = await blankHarness(t);
  await h.start();
  await h.publish('current-A', projectedCommand('cc-plugin', 'first-plugin'));
  assert.match(h.visible(), /Loading/);
  await h.publish('current-A', projectedCommand('cc-plugin', 'first-plugin', managerOutcome('cc-plugin')));
  assert.match(h.visible(), /Installed plugins/);
  assert.equal(h.rows().length, 3);
  assert.equal(h.reads('plugins.list').length, 1);
  assert.equal(h.timelines().length, 0);
  assert.equal(h.prompts.length, 0);
});

for (const name of ['cc-export', 'reload-cc-plugins', 'reload-skills']) {
  test(`first ${name} results and errors are visibly rendered without a user message`, async (t) => {
    const h = await blankHarness(t);
    await h.start();
    await h.publish('current-A', projectedCommand(name, 'generic-first'));
    assert.match(h.visible(), /Loading/);
    const success = `${name}: fixture completed successfully`;
    await h.publish('current-A', projectedCommand(name, 'generic-first', { kind: 'success', text: success }));
    assert.ok(h.visible().includes(success), 'a result hidden in a closed details element is not visible');
    assert.equal(h.cards().length, 1);
    assert.equal(h.requests.length, 0, 'generic results must not instantiate a plugin/session manager');
    const failure = `${name}: fixture failed`;
    await h.publish('current-A', projectedCommand(name, 'generic-first', { kind: 'error', text: failure }));
    assert.ok(h.visible().includes(failure));
    assert.ok(h.root().findAll((node) => node.props.role === 'alert').some((node) => text(node).includes(failure)));
    assert.equal(h.timelines().length, 0);
    assert.equal(h.prompts.length, 0);
  });
}

test('only the latest five managed commands appear, and an older item can be collapsed', async (t) => {
  const h = await blankHarness(t);
  await h.start();
  for (let index = 0; index < 7; index++) {
    await h.publish('current-A', projectedCommand('cc-export', `export-${index}`, { kind: 'success', text: `visible-result-${index}` }, { seq: index + 1 }));
  }
  await h.publish('current-A', projectedCommand('cc-unknown', 'not-managed', { kind: 'success', text: 'unmanaged-result' }));
  assert.equal(h.cards().length, 5);
  assert.doesNotMatch(h.visible(), /visible-result-[01]|unmanaged-result/);
  assert.match(h.visible(), /visible-result-6/);
  const latestDetails = h.cards()[0].findByType('details');
  const olderDetails = h.cards().at(-1).findByType('details');
  assert.equal(latestDetails.props.open, true, 'the newest generic result starts visible');
  assert.equal(olderDetails.props.open, false, 'older generic results use a collapsed native disclosure');
  assert.equal(olderDetails.findAllByType('summary').length, 1, 'the native disclosure remains keyboard accessible');
  await h.publish('current-A', projectedCommand('cc-plugin', 'older-manager', managerOutcome('cc-plugin'), { seq: 8 }));
  await h.publish('current-A', projectedCommand('cc-plugin', 'newest-manager', managerOutcome('cc-plugin'), { seq: 9 }));
  assert.equal(h.cards().length, 5);
  const older = h.cards()[1];
  const toggle = older.findAll((node) => node.type === 'button' && node.props['aria-expanded'] === false)[0];
  assert.ok(toggle, 'an older manager retains its accessible disclosure');
  await h.click(toggle);
  const open = h.cards()[1].findAll((node) => node.type === 'button' && node.props['aria-expanded'] === true)[0];
  assert.ok(open);
  await h.click(open);
  assert.equal(h.cards()[1].findAll((node) => node.type === 'button' && node.props['aria-expanded'] === false).length, 1);
  assert.equal(h.cards()[0].findAll((node) => node.type === 'button' && node.props['aria-expanded'] === true).length, 1,
    'collapsing an old manager leaves the newest manager open');
});

for (const transition of ['active-target', 'running', 'prompt-attempted', 'user-message']) {
  test(`the first-command fallback yields to the normal timeline on ${transition}`, async (t) => {
    const h = await blankHarness(t);
    await h.start();
    await h.publish('current-A', projectedCommand('cc-resume', 'first', managerOutcome('cc-resume')));
    assert.equal(h.cards().length, 1);
    assert.equal(h.timelines().length, 0);
    if (transition === 'active-target') await h.phase('current-A', {}, new Map([['chat', { id: 'chat' }]]));
    else if (transition === 'user-message') {
      await h.publish('current-A', { kind: 'user', id: 'native-user-message', data: { role: 'user', text: 'Normal native user input' } });
      await h.phase('current-A', { blank: false }, new Map([['chat', { id: 'chat' }]]));
    } else await h.phase('current-A', transition === 'running' ? { running: true } : { promptAttempted: true });
    assert.equal(h.timelines().length, 1);
    assert.equal(h.cards().length, 1, 'the dock must not duplicate the command now owned by the native timeline');
    const dock = h.docks()[0];
    assert.equal(dock.findAll((node) => node.type === 'div' && String(node.props.className).split(' ').includes('dcc-card')).length, 0);
    assert.equal(h.prompts.length, 0);
  });
}

test('switching blank sessions does not reuse another command manager or source directory', async (t) => {
  const h = await blankHarness(t);
  await h.start('current-A');
  await h.publish('current-A', projectedCommand('cc-resume', 'same-command-id', managerOutcome('cc-resume', '/source-A')));
  assert.equal(h.reads('status').at(-1).sessionId, 'current-A');
  assert.equal(h.reads('sessions.list').at(-1).cwd, '/source-A');
  await h.switchSession('current-B');
  assert.equal(h.cards().length, 0);
  await h.publish('current-B', projectedCommand('cc-resume', 'same-command-id', managerOutcome('cc-resume', '/source-B')));
  assert.equal(h.cards().length, 1);
  assert.equal(h.reads('status').at(-1).sessionId, 'current-B');
  assert.equal(h.reads('sessions.list').at(-1).cwd, '/source-B');
  assert.equal(h.root().findAll((node) => node.type === 'input' && node.props['aria-label'] === 'Project directory')[0].props.value, '/source-B');
  assert.equal(h.timelines().length, 0);
  assert.equal(h.prompts.length, 0);
  await h.unmount();
  for (const id of ['current-A', 'current-B']) {
    const current = h.scope(id);
    assert.equal(current.session.subscribers(), 0);
    assert.equal(current.chat.subscribers(), 0);
    assert.equal(current.conversation.subscribers(), 0);
  }
});

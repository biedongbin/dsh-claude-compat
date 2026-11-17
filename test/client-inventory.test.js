import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react-test-renderer';
import { clientHarness, deferred, text } from './client-kit.js';

const plugin = (name) => ({ id: `plugin:${name}`, name, kind: 'plugin', source: 'claude-plugin', path: `/fixtures/${name}`, plugin: { key: `${name}@fixture`, enabledInClaude: true }, provides: { skill: 1 } });
const skill = (name, extra = {}) => ({ id: `project-claude#skill:${name}`, name, kind: 'skill', source: 'project-claude', path: `/fixtures/${name}.md`, ...extra });
async function inventory(t, options = {}) {
  const all = options.items ?? [plugin('A'), plugin('B'), skill('Alpha'), skill('Beta')];
  return clientHarness(t, { inventory: true, ...options, rpc: async (context) => {
    const { payload: p, next } = context;
    const custom = await options.respond?.(context);
    if (custom !== undefined) return custom;
    if (p.action === 'inventory.list') {
      const items = all.filter((item) => (!p.kind || item.kind === p.kind) && (!p.source || item.source === p.source)
        && (!p.plugin || item.pluginKey === p.plugin) && (!p.query || item.name.toLowerCase().includes(p.query.toLowerCase()))
        && (p.duplicates || !item.overriddenBy));
      return { items: items.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 20)), total: items.length,
        hasMore: (p.offset ?? 0) + (p.limit ?? 20) < items.length, counts: { plugin: 2, skill: all.length }, shadowedCounts: { skill: 1 } };
    }
    if (p.action === 'inventory.trash-list') return { items: options.trash ?? [], total: options.trash?.length ?? 0 };
    if (p.action === 'inventory.read') return { content: `original ${p.id}`, contentHash: p.id, bytes: 10, mtime: 1 };
    if (p.action.startsWith('inventory.') || p.action === 'operation.start') throw new Error(`Unconfigured fixture mutation: ${p.action}`);
    return next();
  } });
}
const rows = (h) => h.root().findAll((n) => n.type === 'li' && String(n.props.className).split(' ').includes('dcc-inv-item'));
function row(h, name) { const found = rows(h).find((n) => n.findAll((c) => c.props.className === 'dcc-inv-nm').some((n) => text(n).startsWith(name))); assert.ok(found, name); return found; }
const search = (h) => h.root().findByProps({ type: 'search' });
const detail = (h) => h.root().findByType('aside');
const nav = (h, label) => h.root().findAll((n) => n.type === 'button' && text(n).startsWith(label))[0];
const pageSize = (h) => h.root().findByProps({ 'aria-label': 'Items per page', value: h.reads('inventory.list').at(-1).limit });

// All reads and mutations above are fixture RPC responses. No inventory service
// or filesystem mutation is reachable from this suite.
test('inventory search types, clears, restores with Back and survives remount', async (t) => {
  const h = await inventory(t, { savedView: { kind: 'skill' } }); await h.render();
  await h.change(search(h), 'Alpha'); await h.advance(220);
  assert.deepEqual(rows(h).map((n) => text(n).includes('Alpha')), [true]);
  await h.change(search(h), ''); await h.advance(220); assert.equal(rows(h).length, 2);
  await h.click(h.button(h.root(), '← Back'));
  assert.equal(search(h).props.value, 'Alpha'); assert.equal(rows(h).length, 1);
  await h.advance(220); assert.equal(h.reads('inventory.list').at(-1).query, 'Alpha');
  await h.unmount(); await h.render();
  assert.equal(search(h).props.value, 'Alpha'); assert.equal(rows(h).length, 1);
});

test('plugin drill, reset and Back restore kind, selection and page size', async (t) => {
  const items = [plugin('A'), skill('Alpha', { pluginKey: 'A@fixture', pluginName: 'A' })];
  const h = await inventory(t, { items }); await h.render();
  await h.change(pageSize(h), '50'); await h.click(row(h, 'A'));
  await h.click(detail(h).findByProps({ className: 'dcc-provides-item' }));
  assert.equal(h.reads('inventory.list').at(-1).plugin, 'A@fixture');
  assert.equal(h.reads('inventory.list').at(-1).duplicates, true);
  assert.equal(h.root().findAllByProps({ className: 'dcc-filter-chip' }).length, 1);
  assert.equal(h.root().findAll((n) => n.type === 'button' && text(n) === 'Clear all').length, 0);
  await h.click(h.root().findByProps({ className: 'dcc-filter-chip' }));
  assert.equal(h.reads('inventory.list').at(-1).plugin, undefined);
  await h.click(h.button(h.root(), '← Back')); assert.equal(h.reads('inventory.list').at(-1).plugin, 'A@fixture');
  await h.click(h.button(h.root(), '← Back')); assert.equal(h.reads('inventory.list').at(-1).kind, 'plugin');
  assert.match(text(detail(h)), /A/);
  await h.change(pageSize(h), '20'); await h.click(h.button(h.root(), '← Back'));
  assert.equal(h.reads('inventory.list').at(-1).limit, 50);
});

test('trash renders each entry once without toggle or fictitious pagination', async (t) => {
  const h = await inventory(t, { trash: Array.from({ length: 21 }, (_, i) => ({ id: `trash-${i}`, name: `Gone${i}`, originalPath: `/fixtures/${i}`, trashedAt: 'today' })) });
  await h.render(); await h.click(h.button(h.root(), '🗑 Trash'));
  assert.equal(rows(h).length, 21);
  assert.equal(h.root().findAllByProps({ type: 'checkbox' }).length, 0);
  assert.equal(h.root().findAllByProps({ 'aria-label': 'Pagination' }).length, 0);
  assert.equal(h.root().findAll((n) => n.type === 'button' && text(n) === 'Restore').length, 21);
});

test('selected detail retains operation submission errors and failed tasks', async (t) => {
  const h = await inventory(t, { respond: ({ payload }) => {
    if (payload.action === 'operation.start') throw new Error('fixture admission rejected');
  } }); await h.render(); await h.click(row(h, 'A'));
  await h.click(h.button(detail(h), 'Update'));
  assert.ok(h.root().findAllByProps({ role: 'alert' }).some((n) => text(n).includes('fixture admission rejected')));
  await h.advance(5000);
  assert.ok(h.root().findAllByProps({ role: 'alert' }).some((n) => text(n).includes('fixture admission rejected')));
});

test('terminal failures remain visible with a selected plugin', async (t) => {
  const h = await inventory(t, { respond: ({ payload }) => {
    if (payload.action === 'operation.list') return { generation: 'fixture', revision: 1, items: [{ id: 'failed', key: JSON.stringify(['plugin', 'A@fixture']), action: 'plugins.update', target: 'A@fixture', state: 'failed', createdAt: 1, revision: 1, generation: 'fixture', result: { error: 'fixture download failed' } }] };
  } }); await h.render(); await h.click(row(h, 'A'));
  assert.match(text(detail(h)), /fixture download failed/);
  assert.ok(detail(h).findAllByProps({ role: 'status' }).some((n) => text(n) === 'Operation failed'));
});

test('directory change clears confirmation, viewer and navigation history', async (t) => {
  const h = await inventory(t, { services: { uiWorkspace: { pickDirectory: async () => '/other-fixture' } } });
  await h.render(); await h.click(row(h, 'A'));
  await h.click(h.button(detail(h), 'Uninstall plugin (Claude side)'));
  await h.click(h.button(detail(h), '📄 View content'));
  await h.click(h.button(h.root(), 'Choose directory'));
  assert.equal(h.root().findAllByProps({ 'aria-label': 'Confirm' }).length, 0);
  assert.equal(h.root().findAllByProps({ className: 'dcc-file-view dcc-file-full' }).length, 0);
  assert.equal(h.button(h.root(), '← Back').props.disabled, true);
  assert.equal(h.reads('inventory.list').at(-1).cwd, '/other-fixture');
  await h.unmount(); await h.render(); assert.equal(h.reads('inventory.list').at(-1).cwd, '/other-fixture');
});

test('late reload cannot replace another file and viewer is grid sibling', async (t) => {
  const late = deferred(); let reads = 0;
  const h = await inventory(t, { respond: ({ payload }) => {
    if (payload.action === 'inventory.read' && payload.id === 'plugin:A' && ++reads === 2) return late.promise;
  } }); await h.render(); await h.click(row(h, 'A')); await h.click(h.button(detail(h), '📄 View content'));
  const grid = h.root().findByProps({ className: 'dcc-inv' });
  const viewer = h.root().findByProps({ className: 'dcc-file-view dcc-file-full' });
  assert.equal(viewer.parent.parent, grid, 'FileViewer component is a direct grid child');
  assert.equal(detail(h).findAllByProps({ className: 'dcc-file-view dcc-file-full' }).length, 0);
  assert.equal(detail(h).props['aria-hidden'], true);
  assert.equal(detail(h).props.inert, '');
  await h.click(h.button(h.root(), 'Reload')); await h.click(h.button(h.root(), 'Back to details'));
  await h.click(row(h, 'B')); await h.click(h.button(detail(h), '📄 View content'));
  late.resolve({ content: 'WRONG A', contentHash: 'plugin:A' }); await h.flush();
  assert.match(text(h.root().findByType('pre')), /original plugin:B/);
  assert.doesNotMatch(text(h.root().findByType('pre')), /WRONG A/);
});

test('translation restores on reopen and unchanged terminal result is fetched only once', async (t) => {
  let evicted = false;
  let job = { id: 'translation', action: 'inventory.translate', itemId: 'plugin:A', cwd: '/fixture-project', lang: 'en', state: 'running', revision: 1, generation: 'fixture', createdAt: 1, key: JSON.stringify(['translation', '/fixture-project', 'plugin:A', 'en']) };
  const h = await inventory(t, { respond: ({ payload }) => {
    if (payload.action === 'operation.list') return { generation: 'fixture', revision: job.revision, items: evicted ? [] : [job] };
    if (payload.action === 'operation.status') return job;
  } }); await h.render(); await h.click(row(h, 'A')); await h.click(h.button(detail(h), '📄 View content'));
  assert.equal(h.button(h.root(), '🌐 Translate').props.disabled, true);
  await h.click(h.button(h.root(), 'Back to details')); await h.click(h.button(detail(h), '📄 View content'));
  assert.equal(h.reads('operation.start').length, 0);
  job = { ...job, state: 'done', revision: 2, result: { content: 'translated fixture', sourceHash: 'plugin:A' } };
  await h.advance(1000);
  assert.ok(h.root().findAllByType('pre').some((n) => text(n) === 'translated fixture'));
  const statuses = h.reads('operation.status').length;
  await h.advance(5000); await h.advance(5000);
  assert.equal(h.reads('operation.status').length, statuses, 'idle polls never transfer the same full terminal result again');
  evicted = true; await h.advance(5000);
  assert.ok(h.root().findAllByType('pre').some((n) => text(n) === 'translated fixture'), 'eviction from bounded host history does not erase the open translation');
  await h.click(h.button(h.root(), '↩ Show original'));
  assert.equal(h.root().findAllByType('pre').length, 1);
});

test('display-only inventory rows have text status rather than a checkbox', async (t) => {
  const h = await inventory(t, { savedView: { kind: 'skill' }, items: [skill('ReadOnly', { toggleable: false, disabledByPlugin: true })] }); await h.render();
  assert.equal(row(h, 'ReadOnly').findAllByProps({ type: 'checkbox' }).length, 0);
  assert.match(text(row(h, 'ReadOnly')), /Disabled/);
  await h.click(row(h, 'ReadOnly')); assert.match(text(detail(h)), /Disabled by the owning plugin/);
});

test('shadow jump clears source and plugin restrictions and searches later pages', async (t) => {
  const winner = skill('Winner', { id: 'user-claude#skill:winner', source: 'user-claude' });
  const duplicate = skill('Duplicate', { pluginKey: 'A@fixture', overriddenBy: winner.id, overriddenByKind: 'skill', overriddenByName: 'Other' });
  const h = await inventory(t, { savedView: { kind: 'skill', source: 'project-claude', showDuplicates: true, pluginFilter: { key: 'A@fixture', name: 'A', forKind: 'skill' } },
    items: [...Array.from({ length: 25 }, (_, i) => skill(`Item${i}`)), winner, duplicate] });
  await h.render(); await h.click(row(h, 'Duplicate')); await h.click(h.button(detail(h), 'Go to the copy in use'));
  const request = h.reads('inventory.list').at(-1);
  assert.equal(request.source, undefined); assert.equal(request.plugin, undefined); assert.equal(request.offset, 20);
  assert.match(text(detail(h)), /Winner/);
});

test('update all visits every page and reports only accepted submissions', async (t) => {
  let submissions = 0;
  const h = await inventory(t, { items: Array.from({ length: 301 }, (_, i) => plugin(`P${i}`)), respond: ({ payload }) => {
    if (payload.action !== 'operation.start') return;
    submissions++;
    if (submissions === 2) throw new Error('fixture queue unavailable');
    return { id: `job-${submissions}`, key: JSON.stringify(['plugin', payload.request.target]), action: 'plugins.update', target: payload.request.target,
      state: 'queued', generation: 'fixture', revision: submissions, createdAt: submissions };
  } }); await h.render(); await h.click(row(h, 'P0'));
  let batch;
  await act(async () => { batch = h.button(h.root(), 'Update all plugins').props.onClick(); });
  for (let page = 0; page < 15; page++) await h.advance(700);
  await batch;
  assert.equal(submissions, 301);
  assert.match(text(detail(h)), /Update tasks queued: 300 · Operation failed: 1/);
  assert.ok(h.reads('inventory.list').some((p) => p.offset === 300));
});

test('unavailable optional localStorage does not crash inventory', async (t) => {
  const h = await inventory(t, { storage: { getItem() { throw new Error('storage blocked'); }, setItem() { throw new Error('storage blocked'); } } });
  await h.render(); assert.equal(rows(h).length, 2);
});


test('leaving inventory stops remaining batch submissions without cancelling accepted tasks', async (t) => {
  const gate = deferred(); let submitted = 0;
  const h = await inventory(t, { items: [plugin('A'), plugin('B'), plugin('C')], respond: ({ payload }) => {
    if (payload.action !== 'operation.start') return;
    submitted++; return gate.promise;
  } }); await h.render();
  await act(async () => { void h.button(h.root(), 'Update all plugins').props.onClick(); });
  await h.flush(); assert.equal(submitted, 1);
  await h.unmount();
  gate.resolve({ id: 'accepted', state: 'queued', action: 'plugins.update', generation: 'fixture', revision: 1, createdAt: 1, key: JSON.stringify(['plugin', 'A@fixture']) });
  await h.flush();
  assert.equal(submitted, 1, 'unmounted UI must not submit B or C');
  assert.equal(h.reads('operation.cancel').length, 0, 'accepted host tasks keep running');
});

test('manual tab navigation cancels a duplicate jump waiting on another page', async (t) => {
  const late = deferred(); let held = false;
  const winner = skill('Winner', { id: 'winner' });
  const duplicate = skill('Duplicate', { overriddenBy: winner.id, overriddenByKind: 'skill', overriddenByName: 'Other' });
  const h = await inventory(t, { savedView: { kind: 'skill', showDuplicates: true },
    items: [duplicate, ...Array.from({ length: 25 }, (_, i) => skill(`Item${i}`)), winner, plugin('A')],
    respond: ({ payload }) => {
      if (payload.action === 'inventory.list' && payload.kind === 'skill' && payload.offset === 20) { held = true; return late.promise; }
    } });
  await h.render(); await h.click(row(h, 'Duplicate')); await h.click(h.button(detail(h), 'Go to the copy in use'));
  assert.equal(held, true);
  await h.click(nav(h, 'Plugins'));
  late.resolve({ items: [winner], total: 27, hasMore: false }); await h.flush();
  assert.equal(h.reads('inventory.list').at(-1).kind, 'plugin');
  assert.equal(h.reads('inventory.list').at(-1).offset, 0);
  assert.doesNotMatch(text(detail(h)), /Winner|Unavailable/);
});

test('empty trash ignores search filters and never invents zero global counts', async (t) => {
  const h = await inventory(t, { savedView: { kind: 'skill', search: 'absent' } }); await h.render();
  await h.click(h.button(h.root(), '🗑 Trash'));
  assert.match(text(h.root()), /Trash is empty/);
  assert.doesNotMatch(text(h.root()), /Nothing matches these filters/);
  assert.ok(h.root().findAllByProps({ className: 'dcc-inv-cnt' }).every((n) => text(n) === '—'));
});


test('checkbox keyboard events do not activate the containing inventory row', async (t) => {
  const h = await inventory(t, { savedView: { kind: 'skill' } }); await h.render();
  const entry = row(h, 'Alpha'), checkbox = entry.findByProps({ type: 'checkbox' });
  let stopped = false, prevented = false;
  const event = { key: ' ', target: checkbox, currentTarget: entry,
    stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } };
  await act(async () => {
    checkbox.parent.props.onKeyDown(event);
    if (!stopped) entry.props.onKeyDown(event);
  });
  assert.equal(stopped, true); assert.equal(prevented, false, 'native checkbox Space remains available');
  assert.match(text(detail(h)), /Select an item/);
  await act(async () => { entry.props.onKeyDown(event); });
  assert.equal(prevented, false, 'row also ignores descendant events independently');
  assert.match(text(detail(h)), /Select an item/);
  await act(async () => { entry.props.onKeyDown({ ...event, target: entry }); });
  assert.match(text(detail(h)), /Alpha/);
});


test('update all waits at the host limit until an active slot is released', async (t) => {
  const jobs = []; let revision = 0, rejected = 0;
  const h = await inventory(t, { items: Array.from({ length: 21 }, (_, i) => plugin(`Capacity${i}`)), respond: ({ payload }) => {
    if (payload.action === 'operation.list') return { generation: 'capacity', revision, items: [...jobs] };
    if (payload.action !== 'operation.start') return;
    if (jobs.filter((job) => job.state === 'queued').length >= 20) { rejected++; throw new Error('capacity exceeded'); }
    const job = { id: payload.id, key: JSON.stringify(['plugin', payload.request.target]), action: 'plugins.update', target: payload.request.target,
      state: 'queued', generation: 'capacity', revision: ++revision, createdAt: revision };
    jobs.push(job); return job;
  } }); await h.render();
  let batch;
  await act(async () => { batch = h.button(h.root(), 'Update all plugins').props.onClick(); });
  await h.flush();
  assert.equal(h.reads('operation.start').length, 20); assert.equal(rejected, 0);
  assert.match(text(detail(h)), /Waiting for running tasks to finish/);
  jobs[0] = { ...jobs[0], state: 'done', revision: ++revision, result: { ok: true } };
  await h.advance(700); await batch;
  assert.equal(h.reads('operation.start').length, 21); assert.equal(rejected, 0);
  assert.match(text(detail(h)), /Update tasks queued: 21 · Operation failed: 0/);
});

// Cordis 4 (DSH 0.2.2-rc.1 and newer) throws when a plugin reads a service it
// never declared in `inject`, and `?.` cannot guard a property read that throws
// from inside the read. The hook payload resolves the optional working-directory
// service on every tool call, so one bare `ctx.workingDirectory` read failed
// every tool call with `cannot get property "workingDirectory" without inject`.
//
// These tests mount a real Cordis context and load the support layer with
// `inject: ['skills']`, the same declaration src/index.js uses. The Cordis part
// skips itself when the peer packages are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceOf } from '../src/compat.js';

async function load(name) {
  try {
    return await import(name);
  } catch {
    return undefined;
  }
}

const cordis = await load('@deepseek-ai/cordis');
const supportPkg = typeof cordis?.Context === 'function' ? await load('../src/hook-support.js') : undefined;
const canMount = typeof supportPkg?.createSupport === 'function';
const needs = (ok, why) => (ok ? {} : { skip: `${why} is not installed` });

// A session shaped like the one DSH hands a hook payload.
function agentIn(cwd) {
  return { session: { header: { id: 'session-1', cwd } } };
}

// One plugin provides the services the deployment would: `skills` is required,
// `workingDirectory` is optional and must still be readable.
async function mount(inject, provide) {
  const root = new cordis.Context();
  await root.plugin({ name: 'test-environment', apply: provide });
  let scope;
  let support;
  await root.plugin({
    name: 'compat-under-test',
    inject,
    apply(ctx) {
      scope = ctx;
      support = supportPkg.createSupport(ctx);
    },
  });
  return { scope, support };
}

test('cwd reads the optional working directory without declaring it in inject',
  needs(canMount, 'cordis and the DSH peers'), async () => {
    // Whether or not this test runs, record why it is here.
    const { scope, support } = await mount(['skills'], (ctx) => {
      ctx.provide('skills', {});
      ctx.provide('workingDirectory', {
        get: (session) => `/committed/${session.header.id}`,
      });
    });

    // The regression: a bare read on a Cordis 4 context fails, so the fallback
    // chain never reached the service.
    assert.throws(() => scope.workingDirectory, /without inject/);
    // The payload path now reaches it.
    assert.equal(support.cwd(agentIn('/start')), '/committed/session-1');
  });

test('cwd falls back to the session start directory without the service',
  needs(canMount, 'cordis and the DSH peers'), async () => {
    const { support } = await mount(['skills'], (ctx) => {
      ctx.provide('skills', {});
    });
    assert.equal(support.cwd(agentIn('/start')), '/start');
  });

test('serviceOf falls back to the property read on a host without ctx.get', () => {
  const service = { get: () => '/legacy' };
  assert.equal(serviceOf({ workingDirectory: service }, 'workingDirectory'), service);
  assert.equal(serviceOf({ workingDirectory: undefined }, 'workingDirectory'), undefined);
  assert.equal(serviceOf(undefined, 'workingDirectory'), undefined);
});

test('serviceOf treats an unreadable property as absent', () => {
  // A context that throws for every read cannot break the payload either.
  const hostile = new Proxy({}, { get() { throw new Error('cannot get property "workingDirectory" without inject'); } });
  assert.equal(serviceOf(hostile, 'workingDirectory'), undefined);
});

// Contract tests against the shipped DSH services. The hook bridges run on a real tool registry,
// a real agent loop, and the real working-directory service, so a listener that expects a
// payload field the runtime never sends fails here, not only in a deployment. The suite skips
// itself when the DSH peer packages (dsh-agent-loop-testkit 0.2.1-rc.5 or newer) are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createModelRunners } from '../src/hook-runners-model.js';
import { registerHooks } from '../src/hooks.js';
import { tempDir, waitFor } from './hook-kit.js';

async function load(name) {
  try {
    return await import(name);
  } catch {
    return undefined;
  }
}

const cordis = await load('@deepseek-ai/cordis');
const toolsPkg = await load('@deepseek-ai/dsh-tools');
const executorPkg = await load('@deepseek-ai/dsh-tool-executor-native');
const scopePkg = await load('@deepseek-ai/dsh-scope');
const promptPkg = await load('@deepseek-ai/dsh-system-prompt');
const testkit = await load('@deepseek-ai/dsh-agent-loop-testkit');
const llmPkg = await load('@deepseek-ai/dsh-llm');
const sessionPkg = await load('@deepseek-ai/dsh-session');

const hasTools = [cordis, toolsPkg, executorPkg, scopePkg, promptPkg].every(Boolean);
const hasLoop = hasTools && [testkit, llmPkg, sessionPkg].every(Boolean);
const needs = (ok, why) => (ok ? {} : { skip: `${why} is not installed` });

// ─── a real tool registry ────────────────────────────────────────────────────

async function mountTools() {
  const ctx = new cordis.Context();
  await ctx.plugin(promptPkg.default, {});
  await ctx.plugin(toolsPkg.default);
  // DSH 0.2.2 separates tool registration from its selected executor.
  await ctx.plugin(executorPkg);
  return ctx;
}

// The tool answers with its arguments, so the test sees what the registry delivered.
const echoTool = (name) => ({
  name,
  description: `tool ${name}`,
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async (args) => JSON.stringify(args),
});

const mcpHook = (server) => ({ type: 'mcp_tool', server, tool: 'scan', input: { path: '${tool_input.file_path}' } });
const payload = JSON.stringify({ tool_input: { file_path: '/p/a.js' } });
const options = (agent) => ({ timeoutMs: 5000, agent });

test('mcp_tool hook: a global tool runs through the real ToolRuntime.execute', needs(hasTools, 'dsh-tools'), async () => {
  const ctx = await mountTools();
  ctx.tools.register(echoTool('mcp__srv__scan'));
  const runner = createModelRunners(ctx, {}).mcp_tool;
  const run = await runner(mcpHook('srv'), payload, options(undefined));
  assert.deepEqual([run.failed, run.exitCode, run.stdout], [false, 0, JSON.stringify({ path: '/p/a.js' })]);
  await ctx.fiber.dispose();
});

test('mcp_tool hook: a tool that only the calling agent has connected runs for that agent only', needs(hasTools, 'dsh-tools'), async () => {
  const ctx = await mountTools();
  const owner = { id: 'owner', session: { id: 'owner' } };
  const other = { id: 'other', session: { id: 'other' } };
  let scope;
  // The scope is minted by a plugin that injects the services scope holders reach.
  await ctx.plugin(Object.assign((inner) => { scope = scopePkg.createScope(inner, owner); }, { inject: ['tools', 'systemPrompt'] }));
  scope.ctx.tools.register(echoTool('mcp__own__scan'));
  const runner = createModelRunners(ctx, {}).mcp_tool;

  const ran = await runner(mcpHook('own'), payload, options(owner));
  assert.deepEqual([ran.failed, ran.stdout], [false, JSON.stringify({ path: '/p/a.js' })]);

  const outsider = await runner(mcpHook('own'), payload, options(other));
  assert.equal(outsider.failed, true);
  assert.match(outsider.reason, /MCP tool mcp__own__scan is not available/);

  const global = await runner(mcpHook('own'), payload, options(undefined));
  assert.equal(global.failed, true, 'no agent, no scoped tool');
  await ctx.fiber.dispose();
});

test('mcp_tool hook: an unknown tool and a failing tool are failed runs', needs(hasTools, 'dsh-tools'), async () => {
  const ctx = await mountTools();
  ctx.tools.register({ ...echoTool('mcp__srv__scan'), execute: async () => { throw new Error('database is down'); } });
  const runner = createModelRunners(ctx, {}).mcp_tool;
  const missing = await runner(mcpHook('nope'), payload, options(undefined));
  assert.match(missing.reason, /not available/);
  const broken = await runner(mcpHook('srv'), payload, options(undefined));
  assert.equal(broken.failed, true);
  assert.match(broken.reason, /MCP tool mcp__srv__scan failed/);
  await ctx.fiber.dispose();
});

// ─── a real agent loop ───────────────────────────────────────────────────────

function stubAdapter() {
  class StubAdapter extends llmPkg.LlmAdapter {
    requests = [];

    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model });
    }

    async * stream(options) {
      this.requests.push(options);
      const text = 'ok';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  return new StubAdapter();
}

// Mount the real services and our hooks, then the real loop. The hooks register before the loop
// and before any listener of the test, as a plugin loaded early does.
async function mountLoop(hooks, { workingDirectory = false, intervalMs = 20 } = {}) {
  const settings = tempDir('dcc-runtime-');
  writeFileSync(join(settings, 'settings.json'), JSON.stringify({ hooks }));
  const ctx = new cordis.Context();
  await testkit.mountAgentLoopTestDependencies(ctx, { workingDirectory });
  const hooksApi = registerHooks(ctx, { userClaudeDir: settings, projectRootMarkers: ['.git'], hooksTimeoutMs: 5000 }, { intervalMs });
  const loop = await testkit.mountAgentLoopTestHarness(ctx);
  const adapter = stubAdapter();
  ctx.llm.registerAdapter(['mock'], adapter);
  return { ctx, loop, adapter, hooksApi };
}

const say = (agent, text) => agent.followup(llmPkg.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
const readLines = (file) => {
  try {
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
const logTo = (file) => `cat | tr -d '\\n' >> "${file}"; echo >> "${file}"`;

test('PostModelSwitch: a model change in the real agent/request waterfall runs the hook', needs(hasLoop, 'dsh-agent-loop-testkit'), async () => {
  const log = join(tempDir('dcc-runtime-log-'), 'lines');
  const { ctx, loop } = await mountLoop({ PostModelSwitch: [{ hooks: [{ command: logTo(log) }] }] });
  // A listener that loads after the hooks sees the same request and may replace the model.
  let model = 'model-one';
  ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model }));
  const agent = await loop.create(sessionPkg.SessionId('runtime-model'), { provider: 'mock', model: 'mock' });

  say(agent, 'first');
  await agent.whenIdle();
  assert.equal(readLines(log).length, 0, 'the first request is a baseline');
  model = 'model-two';
  say(agent, 'second');
  await agent.whenIdle();

  const [call] = readLines(log);
  assert.deepEqual(
    [readLines(log).length, call.hook_event_name, call.from_model, call.to_model, call.from_provider, call.to_provider, call.session_id],
    [1, 'PostModelSwitch', 'model-one', 'model-two', 'mock', 'mock', 'runtime-model'],
  );
  await ctx.fiber.dispose();
});

test('FileChanged alone follows a real working-directory change', needs(hasLoop, 'dsh-agent-loop-testkit'), async () => {
  const first = realpathSync(tempDir('dcc-runtime-a-'));
  const second = realpathSync(tempDir('dcc-runtime-b-'));
  const log = join(tempDir('dcc-runtime-log-'), 'lines');
  const { ctx, loop } = await mountLoop(
    { FileChanged: [{ matcher: '.envrc', hooks: [{ command: logTo(log) }] }] },
    { workingDirectory: true },
  );
  const agent = await loop.create(sessionPkg.SessionId('runtime-cwd'), { provider: 'mock', model: 'mock' }, { cwd: first });
  await ctx.workingDirectory.set(agent, second);
  await new Promise((resolve) => setTimeout(resolve, 100));
  mkdirSync(first, { recursive: true });
  writeFileSync(join(first, '.envrc'), 'old dir');
  writeFileSync(join(second, '.envrc'), 'new dir');
  assert.ok(await waitFor(() => readLines(log).length >= 1));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(readLines(log).map((call) => [call.file_path, call.cwd]), [[join(second, '.envrc'), second]]);
  await ctx.fiber.dispose();
});

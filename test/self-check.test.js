// Focused self-check: prove this plugin's real contributions against the real
// DSH runtime — a real cordis Context, a real SkillRegistry, and real
// createUserMessage — so precedence and envelope semantics are tested on the
// actual registry code, not on a reimplementation of it.
//
// 1. Skills: fixture project .claude + fixture ~/.claude + a synthetic DSH
//    bundled root (rank 600) all publish a skill named "shared". After the
//    registry dedupes, the winner must be the project .claude one.
// 2. User-only collision: skill "user-only" exists in project .claude and
//    ~/.claude; project .claude must win.
// 3. Bundled-only collision: skill "bundled-only" exists in the bundled root
//    and ~/.claude; the bundled one (600) must win over user (700).
// 4. Commands: same stem in project .claude/commands and ~/.claude/commands;
//    project wins.
// 5. Rules: project .claude/rules and ~/.claude/rules share a basename;
//    the injected message must contain the project text, never the user one.
//
// Run: node --test test/self-check.test.js  (or plain `node test/self-check.test.js`)

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { BUNDLED_SKILL_RANK, SkillRegistry } from '@deepseek-ai/dsh-skill';
import { apply, Config } from '../src/index.js';

function makeSandbox(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSkill(dir, name, description) {
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody ${name}\n`);
}

async function newHarness({ userClaudeDir }) {
  // A real cordis root context and a real skill registry, like dsh-cordis-host.
  const ctx = new Context();
  ctx.skills = new SkillRegistry(ctx);
  // ctx.plugin() returns the plugin fiber (thenable); await it so apply() —
  // and therefore the skill provider registration and the pre-step listener —
  // has actually run before we exercise the registry.
  await ctx.plugin({ name: 'claude-compat', apply, Config }, {
    projectRootMarkers: ['.git'],
    userClaudeDir,
    // hermetic: don't pick up the real ~/.claude/plugins installs
    pluginsRoot: makeSandbox('dcc-plugins-none-'),
  });
  return ctx;
}

test('skill precedence: project .claude > DSH bundled (600) > ~/.claude', async () => {
  const project = makeSandbox('dcc-project-');
  mkdirSync(join(project, '.git'));
  mkdirSync(join(project, '.claude', 'skills', 'shared'), { recursive: true });
  writeSkill(join(project, '.claude', 'skills', 'shared'), 'shared', 'project shared');
  mkdirSync(join(project, '.claude', 'skills', 'user-only'), { recursive: true });
  writeSkill(join(project, '.claude', 'skills', 'user-only'), 'user-only', 'project user-only');
  mkdirSync(join(project, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(project, '.claude', 'commands', 'slash-one.md'), '---\ndescription: project slash\n---\nrun project\n');

  const userClaude = makeSandbox('dcc-user-');
  mkdirSync(join(userClaude, 'skills', 'shared'), { recursive: true });
  writeSkill(join(userClaude, 'skills', 'shared'), 'shared', 'user shared');
  mkdirSync(join(userClaude, 'skills', 'user-only'), { recursive: true });
  writeSkill(join(userClaude, 'skills', 'user-only'), 'user-only', 'user user-only');
  mkdirSync(join(userClaude, 'skills', 'bundled-only'), { recursive: true });
  writeSkill(join(userClaude, 'skills', 'bundled-only'), 'bundled-only', 'user bundled-only');
  mkdirSync(join(userClaude, 'commands'), { recursive: true });
  writeFileSync(join(userClaude, 'commands', 'slash-one.md'), '---\ndescription: user slash\n---\nrun user\n');

  const bundled = makeSandbox('dcc-bundled-');
  mkdirSync(join(bundled, 'shared'), { recursive: true });
  writeSkill(join(bundled, 'shared'), 'shared', 'bundled shared');
  mkdirSync(join(bundled, 'bundled-only'), { recursive: true });
  writeSkill(join(bundled, 'bundled-only'), 'bundled-only', 'bundled bundled-only');

  const ctx = await newHarness({ userClaudeDir: userClaude });

  // Register the bundled root at DSH's own rank 600, as dsh-skill-filesystem does.
  const bundledProvider = {
    name: 'bundled-fixture',
    async list() {
      return ['shared', 'bundled-only'].map((name) => ({
        name,
        description: `bundled ${name}`,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'bundled-fixture',
        source: 'bundled',
        rank: BUNDLED_SKILL_RANK,
        locator: { path: join(bundled, name, 'SKILL.md'), directory: join(bundled, name) },
      }));
    },
    async get(candidate) {
      const { readFile } = await import('node:fs/promises');
      return { ...candidate, content: await readFile(candidate.locator.path, 'utf8') };
    },
  };
  ctx.skills.registerProvider(() => bundledProvider);

  const skills = await ctx.skills.list({ cwd: project });
  const byName = new Map(skills.map((s) => [s.name, s]));
  assert.deepEqual([...byName.keys()].sort(), ['bundled-only', 'cc-export', 'cc-plugin', 'cc-resume', 'reload-cc-plugins', 'reload-skills', 'shared', 'slash-one', 'user-only'], 'catalog exposes the four discovery skills + built-in plugin manager');

  assert.equal(byName.get('shared').source, 'project-claude', 'project .claude beats bundled (600) and ~/.claude (700)');
  assert.equal(byName.get('shared').description, 'project shared');
  assert.equal(byName.get('user-only').source, 'project-claude', 'project .claude beats ~/.claude on a project/user collision');
  assert.equal(byName.get('bundled-only').source, 'bundled', 'DSH bundled (600) beats ~/.claude (700)');
  assert.equal(byName.get('slash-one').source, 'project-claude', 'project .claude command beats ~/.claude command');

  // Load the winner body to prove the winning provider's get() is the one used.
  const loaded = await ctx.skills.get('shared', { cwd: project });
  assert.equal(loaded.source, 'project-claude');
  assert.equal(loaded.content.trim(), 'body shared');

  // No cwd: only user ~/.claude + bundled are visible; shared resolves to the
  // bundled copy (600) over the user copy (700).
  const noCwd = await ctx.skills.list({});
  const namesNoCwd = noCwd.map((s) => s.name).sort();
  assert.deepEqual(namesNoCwd, ['bundled-only', 'cc-export', 'cc-plugin', 'cc-resume', 'reload-cc-plugins', 'reload-skills', 'shared', 'slash-one', 'user-only'], 'without cwd only user ~/.claude + bundled (+ plugin manager & reload skills) are visible');
  assert.equal(noCwd.find((s) => s.name === 'bundled-only').source, 'bundled');
  assert.equal(noCwd.find((s) => s.name === 'shared').source, 'bundled', 'bundled (600) beats user (700) without cwd');
  assert.equal(noCwd.find((s) => s.name === 'user-only').source, 'user-claude');
});

test('rules: project .claude/rules wins same-basename ~/.claude/rules in one envelope', async () => {
  const project = makeSandbox('dcc-rules-project-');
  mkdirSync(join(project, '.git'));
  mkdirSync(join(project, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(project, '.claude', 'rules', 'shared.md'), 'PROJECT RULE TEXT\n');

  const userClaude = makeSandbox('dcc-rules-user-');
  mkdirSync(join(userClaude, 'rules'), { recursive: true });
  writeFileSync(join(userClaude, 'rules', 'shared.md'), 'USER RULE TEXT\n');
  writeFileSync(join(userClaude, 'rules', 'user-only.md'), 'USER ONLY RULE\n');

  const ctx = await newHarness({ userClaudeDir: userClaude });

  // Fire the real agent/pre-step waterfall with the real payload shape.
  const agent = {
    session: {
      header: { cwd: project },
      surface: { nodes: [] },
      events: {},
    },
  };
  const decision = await ctx.waterfall(
    'agent/pre-step',
    { agent, messages: [] },
    async () => ({ kind: 'enter', messages: [] }),
  );
  assert.equal(decision.kind, 'enter');
  assert.ok(decision.messages.length >= 1, 'one rules message is prepended');
  const injected = decision.messages[0];
  assert.equal(injected.role, 'user');
  assert.equal(injected.source?.kind, 'claude-compat');
  const text = injected.content[0].text;
  assert.match(text, /PROJECT RULE TEXT/, 'project rule included');
  assert.doesNotMatch(text, /USER RULE TEXT/, 'user rule with same basename deduped out');
  assert.match(text, /USER ONLY RULE/, 'user-only rule still included');
  assert.match(text, /<system-reminder>/, 'envelope preserved');
});

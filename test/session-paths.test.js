// Issues #11/#12: fixtures use the upstream directory names, independently of
// the helpers under test. Run the real CLI with an isolated home, never ~/.claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claudeProjectFolder, projectKey } from '../src/lib.js';

const cli = fileURLToPath(new URL('../scripts/cc-resume.mjs', import.meta.url));
const id = '12345678-1234-1234-1234-123456789abc';

function fixture(t, cwd, claudeKey) {
  const home = mkdtempSync(join(tmpdir(), 'dcc-session-path-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const source = join(home, '.claude', 'projects', claudeKey);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, `${id}.jsonl`), JSON.stringify({
    type: 'user', cwd, timestamp: '2026-11-04T00:00:00Z',
    message: { role: 'user', content: 'session path regression' },
  }) + '\n');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args, '--cwd', cwd], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { home, run };
}

const cases = [
  ['/Users/me/proj', '-Users-me-proj', '--Users-me-proj--'],
  ['/Users/me/my.project', '-Users-me-my-project', '--Users-me-my.project--'],
  ['/Users/me/my_project', '-Users-me-my-project', '--Users-me-my_project--'],
  ['/Users/me/my project', '-Users-me-my-project', '--Users-me-my~0020project--'],
  ['/Users/me/~proj', '-Users-me--proj', '--Users-me-~007Eproj--'],
  ['/Users/me/项目', '-Users-me---', '--Users-me-~9879~76EE--'],
  ['/Users//me/proj', '-Users--me-proj', '--Users-me-proj--'],
  ['C:\\Users\\me\\proj', 'C--Users-me-proj', '--C-Users-me-proj--'],
  ['/', '-', '--root--'],
  ['/😀', '---', '--~D83D~DE00--'],
  ['/-proj/', '--proj-', '--proj---'],
];

for (const [cwd, claudeKey, dshKey] of cases) {
  test(`list and import use native directory keys: ${cwd}`, (t) => {
    const { home, run } = fixture(t, cwd, claudeKey);
    assert.match(run('list'), new RegExp(`${id.slice(0, 8)}.*session path regression`));
    const imported = run('import', id);
    const logPath = join(home, '.dsh', 'sessions', dshKey, `session-cc-${id}`, 'session.jsonl.zstd');
    assert.ok(existsSync(logPath), `DSH must discover the imported log at ${logPath}; CLI: ${imported}`);
    const log = execFileSync('zstd', ['-d', '-q', '-c'], { input: readFileSync(logPath), encoding: 'utf8', timeout: 15000 });
    assert.equal(JSON.parse(log.split('\n')[0]).cwd, cwd);
    assert.match(run('list'), new RegExp(`${id.slice(0, 8)}.*✓`), 'list detects imports in the same native DSH directory');
  });
}

test('Claude long-name boundary and hash use the full original path', () => {
  assert.equal(claudeProjectFolder('/' + 'a'.repeat(199)), '-' + 'a'.repeat(199));
  assert.equal(claudeProjectFolder('/' + 'a'.repeat(200)), '-' + 'a'.repeat(199) + '-b6ymvl');
  assert.equal(claudeProjectFolder('/' + 'a'.repeat(300)), '-' + 'a'.repeat(199) + '-vtkmfl');
  assert.equal(claudeProjectFolder('/' + 'a'.repeat(299) + 'b'), '-' + 'a'.repeat(199) + '-vtkmfk');
});

test('DSH escapes UTF-16 code units and caps the encoded slug, as upstream does', () => {
  assert.throws(() => projectKey(''), /empty project path/);
  assert.equal(projectKey(String.fromCharCode(0xD800)), '--~D800--');
  assert.equal(projectKey('/' + 'a'.repeat(250) + '中'), '--' + 'a'.repeat(250) + '~--');
  assert.equal(projectKey('///\\\\::'), '--root--');
});

// Claude Code hashes the full path; DSH caps only its escaped slug.
test('long paths use the Claude hash and the 251-character DSH slug', (t) => {
  const cwd = '/' + 'a'.repeat(300);
  // Independently checked against the encoder in Claude Code 2.1.296.
  const { home, run } = fixture(t, cwd, '-' + 'a'.repeat(199) + '-vtkmfl');
  run('import', id);
  assert.ok(existsSync(join(home, '.dsh', 'sessions', '--' + 'a'.repeat(251) + '--', `session-cc-${id}`, 'session.jsonl.zstd')));
});

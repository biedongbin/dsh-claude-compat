// File watcher for FileChanged and ConfigChange (src/hook-watch.js), on real files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWatcher } from '../src/hook-watch.js';
import { tempDir, waitFor } from './hook-kit.js';

function watched(paths, intervalMs = 20) {
  const seen = [];
  const watcher = createWatcher({ onChange: (path, event) => seen.push([path, event]), intervalMs });
  watcher.set('test', paths);
  return { seen, watcher };
}

test('reports add, change and unlink for a watched file', async () => {
  const file = join(tempDir('dcc-watch-'), '.envrc');
  const { seen, watcher } = watched([file]);
  try {
    writeFileSync(file, 'a');
    assert.ok(await waitFor(() => seen.length === 1));
    writeFileSync(file, 'longer content');
    assert.ok(await waitFor(() => seen.length === 2));
    rmSync(file);
    assert.ok(await waitFor(() => seen.length === 3));
    assert.deepEqual(seen, [[file, 'add'], [file, 'change'], [file, 'unlink']]);
  } finally {
    watcher.close();
  }
});

test('a file that exists when the watch starts is not reported as added', () => {
  const file = join(tempDir('dcc-watch-'), 'a.txt');
  writeFileSync(file, 'x');
  const { seen, watcher } = watched([file], 1_000_000);
  watcher.poll();
  watcher.close();
  assert.deepEqual(seen, []);
});

test('a change to another file in the same directory reports nothing', () => {
  const dir = tempDir('dcc-watch-');
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x');
  const { seen, watcher } = watched([file], 1_000_000);
  writeFileSync(join(dir, 'other.txt'), 'y');
  watcher.poll();
  watcher.close();
  assert.deepEqual(seen, []);
});

test('a file that an editor replaces by rename is reported, again and again', () => {
  const dir = tempDir('dcc-watch-');
  const file = join(dir, 'config.json');
  writeFileSync(file, 'one');
  const { seen, watcher } = watched([file], 1_000_000);
  for (const text of ['two two', 'three three three']) {
    writeFileSync(join(dir, 'config.json.tmp'), text);
    renameSync(join(dir, 'config.json.tmp'), file);
    watcher.poll();
  }
  watcher.close();
  assert.deepEqual(seen, [[file, 'change'], [file, 'change']]);
});

test('an unchanged file is reported once per change, not once per poll', () => {
  const file = join(tempDir('dcc-watch-'), 'a.txt');
  const { seen, watcher } = watched([file], 1_000_000);
  writeFileSync(file, 'x');
  watcher.poll();
  watcher.poll();
  watcher.poll();
  watcher.close();
  assert.deepEqual(seen, [[file, 'add']]);
});

test('replacing a group stops the paths it no longer lists, and keeps another group', () => {
  const dir = tempDir('dcc-watch-');
  const [a, b, c] = ['a', 'b', 'c'].map((name) => join(dir, name));
  const { seen, watcher } = watched([a], 1_000_000);
  watcher.set('other', [c]);
  watcher.set('test', [b]);
  for (const path of [a, b, c]) writeFileSync(path, '1');
  watcher.poll();
  watcher.close();
  assert.deepEqual(seen.map(([path]) => path).sort(), [b, c]);
});

test('a path that was dropped and is listed again starts from its current state', () => {
  const file = join(tempDir('dcc-watch-'), 'a.txt');
  const { seen, watcher } = watched([file], 1_000_000);
  watcher.set('test', []);
  writeFileSync(file, 'x');
  watcher.set('test', [file]);
  watcher.poll();
  watcher.close();
  assert.deepEqual(seen, []);
});

test('close stops the timer and every report', async () => {
  const file = join(tempDir('dcc-watch-'), 'a.txt');
  const { seen, watcher } = watched([file]);
  watcher.close();
  writeFileSync(file, 'x');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(seen, []);
});

test('the timer does not keep the process alive', () => {
  const file = join(tempDir('dcc-watch-'), 'a.txt');
  const watcher = createWatcher({ onChange: () => {}, intervalMs: 20 });
  watcher.set('test', [file]);
  // The test run only ends when the timer is unref'd, so reaching the end proves it.
  assert.ok(true);
});

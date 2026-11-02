// dsh-claude-compat: FileChanged.
//
// Claude Code watches the files that a FileChanged matcher names (split on `|`,
// each one a literal file name in the working directory) plus the paths that
// SessionStart, CwdChanged or FileChanged hooks return in `watchPaths`. DSH has no
// file watch event, so the plugin polls the files itself (src/hook-watch.js).

import { basename, isAbsolute, resolve } from 'node:path';
import { isSubagent, sessionIdOf } from './hook-support.js';
import { createWatcher } from './hook-watch.js';

// A hook with no matcher gets the match-all pattern from the settings loader. That
// pattern names no file.
const NO_FILE_MATCHERS = new Set(['', '*', '.*']);

function matcherPaths(engine, cwd) {
  return engine.matchers('file-changed')
    .flatMap((matcher) => matcher.split('|').map((name) => name.trim()))
    .filter((name) => !NO_FILE_MATCHERS.has(name))
    .map((name) => (isAbsolute(name) ? name : resolve(cwd, name)));
}

/**
 * Register the FileChanged watcher and install its controller on `support.files`.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 * @param {{intervalMs?: number}} [options] poll interval, for tests
 */
export function registerFileHooks(ctx, engine, support, { intervalMs } = {}) {
  if (!engine.has('file-changed')) return;
  const states = new Map();

  function refresh(key) {
    const state = states.get(key);
    state.matched = matcherPaths(engine, state.cwd);
    watcher.set(`matcher:${key}`, state.matched);
    watcher.set(`dynamic:${key}`, state.dynamic);
  }

  async function onChange(path, event) {
    for (const [key, state] of states) {
      if (!state.matched.includes(path) && !state.dynamic.includes(path)) continue;
      support.track(engine.fire('file-changed', 'FileChanged', {
        subject: basename(path),
        payload: support.payload('FileChanged', state.agent, { file_path: path, event }),
      }).then((outcome) => {
        if (outcome.watchPathsGiven && states.has(key)) {
          state.dynamic = outcome.watchPaths;
          refresh(key);
        }
      }));
    }
  }

  const watcher = createWatcher({ onChange, intervalMs });
  ctx.effect?.(() => () => watcher.close(), 'dsh-claude-compat: stop file watch');

  support.files = {
    track(agent) {
      const key = sessionIdOf(agent);
      states.set(key, { agent, cwd: support.cwd(agent), dynamic: [], matched: [] });
      refresh(key);
    },
    release(agent) {
      const key = sessionIdOf(agent);
      states.delete(key);
      watcher.set(`matcher:${key}`, []);
      watcher.set(`dynamic:${key}`, []);
    },
    setDynamic(agent, paths) {
      const state = states.get(sessionIdOf(agent));
      if (state === undefined) return;
      state.dynamic = paths;
      refresh(sessionIdOf(agent));
    },
    // `paths` is undefined when the hook returned no `watchPaths`, which keeps the list.
    cwdChanged(session, cwd, paths) {
      const key = sessionIdOf({ session });
      const state = states.get(key);
      if (state === undefined) return;
      state.cwd = cwd;
      if (paths !== undefined) state.dynamic = paths;
      refresh(key);
    },
  };

  ctx.on('agent/created', ({ agent }) => {
    if (!isSubagent(agent)) support.files.track(agent);
  });
  ctx.on('agent/disposed', ({ agent }) => support.files.release(agent));
}

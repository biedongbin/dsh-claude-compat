// dsh-claude-compat: a small file watcher for the FileChanged and ConfigChange hooks.
//
// The watcher polls `stat` on each watched path. It does not use `fs.watch`:
// that API reports nothing in some sandboxes, and it loses a file that an editor
// replaces by rename. A poll sees both cases. The watcher reports `add`, `change`
// and `unlink`, like Claude Code does for FileChanged.

import { statSync } from 'node:fs';

const DEFAULT_INTERVAL_MS = 500;

function fingerprint(path) {
  try {
    const stats = statSync(path);
    return `${stats.mtimeMs}:${stats.size}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

/**
 * Create a watcher. Paths are grouped by owner, so one owner can replace its list
 * without touching the paths of another.
 * @param {{onChange: (path: string, event: 'add'|'change'|'unlink') => void,
 *   intervalMs?: number}} options `onChange` must not throw
 * @returns {{set: (group: string, paths: string[]) => void, poll: () => void, close: () => void}}
 */
export function createWatcher({ onChange, intervalMs = DEFAULT_INTERVAL_MS }) {
  const groups = new Map();
  const known = new Map();
  let timer;

  const wanted = () => new Set([...groups.values()].flatMap((paths) => [...paths]));

  function poll() {
    for (const path of wanted()) {
      const before = known.get(path);
      const now = fingerprint(path);
      known.set(path, now);
      if (before === now) continue;
      if (before === undefined) onChange(path, 'add');
      else if (now === undefined) onChange(path, 'unlink');
      else onChange(path, 'change');
    }
  }

  function sync() {
    const paths = wanted();
    for (const path of paths) if (!known.has(path)) known.set(path, fingerprint(path));
    for (const path of [...known.keys()]) if (!paths.has(path)) known.delete(path);
    if (paths.size > 0 && timer === undefined) {
      timer = setInterval(poll, intervalMs);
      timer.unref();
    } else if (paths.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return {
    set(group, paths) {
      groups.set(group, new Set(paths));
      sync();
    },
    /** Check every path now. The timer calls this. A test may call it directly. */
    poll,
    close() {
      clearInterval(timer);
      timer = undefined;
      groups.clear();
      known.clear();
    },
  };
}

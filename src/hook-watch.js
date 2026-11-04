// dsh-claude-compat: a small file watcher for the FileChanged and ConfigChange hooks.
//
// The watcher polls `stat` on each watched path. It does not use `fs.watch`:
// that API reports nothing in some sandboxes, and it loses a file that an editor
// replaces by rename. A poll sees both cases. The watcher reports `add`, `change`
// and `unlink`, like Claude Code does for FileChanged.

import { statSync } from 'node:fs';

const DEFAULT_INTERVAL_MS = 500;

// A file that exists but cannot be read. It does not count as a change.
const UNREADABLE = 'unreadable';

function fingerprint(path) {
  try {
    const stats = statSync(path);
    return `${stats.mtimeMs}:${stats.size}:${stats.ino}`;
  } catch (error) {
    // A missing file is the normal case. Any other error is a state that cannot be read now.
    return error.code === 'ENOENT' ? undefined : UNREADABLE;
  }
}

/**
 * Create a watcher. Paths are grouped by owner, so one owner can replace its list
 * without touching the paths of another.
 * @param {{onChange: (path: string, event: 'add'|'change'|'unlink') => void,
 *   intervalMs?: number}} options `onChange` must not throw
 * @returns {{set: (group: string, paths: string[]) => void, remove: (group: string) => void,
 *   poll: () => void, close: () => void}}
 */
export function createWatcher({ onChange, intervalMs = DEFAULT_INTERVAL_MS }) {
  const groups = new Map();
  const known = new Map();
  const unreadable = new Set();
  let timer;

  const wanted = () => new Set([...groups.values()].flatMap((paths) => [...paths]));

  function poll() {
    for (const path of wanted()) {
      const before = known.get(path);
      const now = fingerprint(path);
      if (now === UNREADABLE) {
        if (!unreadable.has(path)) {
          unreadable.add(path);
          console.warn(`dsh-claude-compat: cannot read ${path}; changes to it are not reported until it can be read`);
        }
        continue;
      }
      unreadable.delete(path);
      known.set(path, now);
      // A path that could not be read before has no earlier state, so its first read is not an add.
      if (before === now || (before === UNREADABLE && now !== undefined)) continue;
      try {
        if (before === undefined) onChange(path, 'add');
        else if (now === undefined) onChange(path, 'unlink');
        else onChange(path, 'change');
      } catch (error) {
        console.warn(`dsh-claude-compat: file watch handler failed for ${path}: ${error?.message ?? error}`);
      }
    }
  }

  function sync() {
    const paths = wanted();
    for (const path of paths) if (!known.has(path)) known.set(path, fingerprint(path));
    for (const path of [...known.keys()]) {
      if (paths.has(path)) continue;
      known.delete(path);
      unreadable.delete(path);
    }
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
    /** Drop a group and its paths, so a disposed session leaves nothing behind. */
    remove(group) {
      groups.delete(group);
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

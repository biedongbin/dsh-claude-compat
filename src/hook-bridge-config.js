// dsh-claude-compat: ConfigChange.
//
// The plugin polls its settings files (user, project and local `settings.json`) and
// listens to DSH's `skills/change`. After a change, the ConfigChange hooks run. Hooks load
// once at startup and the plugin never reloads them: a file that an agent could write
// must not add a hook that runs without review. A change to a settings file only logs
// that DSH needs a restart. DSH has no event for the policy settings, so `policy_settings`
// never fires.

import { createWatcher } from './hook-watch.js';

/**
 * Register the ConfigChange hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 * @param {{files: {path: string, source: string}[], intervalMs?: number}} options settings files to watch
 */
export function registerConfigHooks(ctx, engine, support, { files, intervalMs }) {
  if (engine.events().size === 0) return;
  const sources = new Map(files.map((file) => [file.path, file.source]));
  let current;

  async function changed(source, filePath) {
    await engine.fire('config-change', 'ConfigChange', {
      subject: source,
      payload: support.payload('ConfigChange', current, {
        source,
        ...filePath === undefined ? {} : { file_path: filePath },
      }),
    });
    if (filePath !== undefined) {
      console.warn(`dsh-claude-compat: ${filePath} changed; hooks load at startup, so restart DSH to apply the change`);
    }
  }

  const watcher = createWatcher({
    onChange: (path) => support.track(changed(sources.get(path), path)),
    intervalMs,
  });
  watcher.set('settings', [...sources.keys()]);
  ctx.effect?.(() => () => watcher.close(), 'dsh-claude-compat: stop settings watch');
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.session?.header?.origin !== 'subagent') current = agent;
  });
  ctx.on('agent/disposed', ({ agent }) => {
    if (agent === current) current = undefined;
  });
  // DSH also reports skills while it starts up. Only a change after the first agent counts.
  ctx.on('skills/change', () => {
    if (current !== undefined) support.track(changed('skills', undefined));
  });
}

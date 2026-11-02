// dsh-claude-compat: ConfigChange.
//
// The plugin polls its settings files (user, project and local `settings.json`)
// and listens to DSH's `skills/change`. After a change, the ConfigChange hooks
// run. A hook that blocks keeps the plugin from applying the new settings. With no
// block, the plugin reloads its hook list, whether or not a ConfigChange hook
// exists. DSH has no event for the policy settings, so `policy_settings` never fires.

import { createWatcher } from './hook-watch.js';

/**
 * Register the ConfigChange hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 * @param {{files: {path: string, source: string}[], reload: () => void,
 *   intervalMs?: number}} options settings files to watch, and the hook reload
 */
export function registerConfigHooks(ctx, engine, support, { files, reload, intervalMs }) {
  if (engine.events().size === 0) return;
  const sources = new Map(files.map((file) => [file.path, file.source]));
  let current;

  async function changed(source, filePath) {
    const outcome = await engine.fire('config-change', 'ConfigChange', {
      subject: source,
      payload: support.payload('ConfigChange', current, {
        source,
        ...filePath === undefined ? {} : { file_path: filePath },
      }),
    });
    if (outcome.blocked || outcome.stopped) {
      console.warn(`dsh-claude-compat: ConfigChange hook blocked the ${source} change; it is not applied: ${outcome.reason ?? outcome.stopReason ?? 'blocked'}`);
      return;
    }
    if (filePath !== undefined) reload();
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
  // DSH also reports skills while it starts up. Only a change after the first agent counts.
  ctx.on('skills/change', () => {
    if (current !== undefined) support.track(changed('skills', undefined));
  });
}

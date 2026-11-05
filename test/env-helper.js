// Shared test helper: run a function with the Claude Code location variables
// cleared and then set to the given values. Restores the originals afterwards,
// so a test never depends on the shell that runs it.

export const LOCATION_VARS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_PLUGIN_CACHE_DIR',
  'CLAUDE_CODE_PLUGIN_SEED_DIR',
  'CLAUDE_CODE_PLUGIN_DIRS',
  'CLAUDE_CODE_PROJECT_DIR_NAME',
];

export async function withEnv(env, fn) {
  const saved = Object.fromEntries(LOCATION_VARS.map((name) => [name, process.env[name]]));
  for (const name of LOCATION_VARS) delete process.env[name];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const name of LOCATION_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

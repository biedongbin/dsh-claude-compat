// dsh-claude-compat: non-ASCII (Chinese) skill names.
//
// DSH's registry only accepts kebab-case names. The grammar lives in
// `@deepseek-ai/dsh-skill`:
//
//   const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
//   // registry.get(name): if (!isSkillName(name)) return void 0;
//
// so a skill whose frontmatter name or directory is written in Chinese can
// never be reached under that name, no matter what this plugin emits. The
// only thing the plugin can do is stop dropping it silently: map it to an
// explicit ASCII slug through the `skillAliases` config and keep the original
// name visible at the front of the description, so the catalog still reads
// "san-nao: 三脑 — …".
//
// Aliased entries keep the provider's own rank, so the existing dedupe ladder
// still applies: an alias that collides with a higher-priority skill (a DSH
// native name, or ~/.agents) loses exactly like any other duplicate instead of
// shadowing it.

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `name` satisfies DSH's public skill-name grammar. */
export function isKebabName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name);
}

/**
 * Keep only usable `skillAliases` entries: plain string → string where the
 * target is itself a legal skill name. Bad targets are dropped rather than
 * emitted and rejected later by the registry.
 */
export function normalizeAliases(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [from, to] of Object.entries(raw)) {
    if (typeof from !== 'string' || from === '') continue;
    if (typeof to !== 'string' || !isKebabName(to)) continue;
    out[from] = to;
  }
  return out;
}

/**
 * Pick the DSH skill name for one candidate.
 *
 * @param candidates names to try, in priority order (frontmatter `name`, then
 *   the flattened directory name / filename stem).
 * @param aliases normalized alias map.
 * @returns `{ name, original }` — `original` is the non-kebab name an alias
 *   replaced, or `undefined` when the natural name already works. `undefined`
 *   when nothing usable was found (the caller should skip and warn).
 */
export function resolveCandidateName(candidates, aliases) {
  const list = (candidates ?? []).filter((n) => typeof n === 'string' && n !== '');
  // A legal name always beats an alias — an alias must never rename a skill
  // that DSH can already load under its own name.
  for (const candidate of list) {
    if (isKebabName(candidate)) return { name: candidate, original: undefined };
  }
  for (const candidate of list) {
    const mapped = aliases?.[candidate];
    if (mapped !== undefined) return { name: mapped, original: candidate };
  }
  return undefined;
}

/**
 * Put the original (Chinese) name back in front of the description so it shows
 * up in the skill catalog and the slash menu: "三脑 — 三脑复核流程…".
 * Idempotent, so a caller that resolves twice cannot double-prefix.
 */
export function withOriginalName(description, original) {
  if (original === undefined) return description;
  if (typeof description !== 'string' || description === '') return description;
  const prefix = `${original} — `;
  return description.startsWith(prefix) ? description : `${prefix}${description}`;
}

// One warning per skipped file per process: discovery runs on every catalog
// collect, and an un-mapped Chinese skill must not flood the log.
const warned = new Set();

/** Warn once that `name` cannot be surfaced, and how to fix it. */
export function warnUnmapped(kind, name, path) {
  const key = `${kind}\u0000${path}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `dsh-claude-compat: ${kind} "${name}" (${path}) is not a kebab-case name and has no `
    + `skillAliases mapping, so DSH cannot load it. Add one to the plugin config, e.g. `
    + `skillAliases: { "${name}": "your-slug" }`,
  );
}

/** Test seam: forget which paths have already warned. */
export function resetWarnings() {
  warned.clear();
}

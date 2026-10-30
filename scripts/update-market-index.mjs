#!/usr/bin/env node
// Regenerate site/index.json — the DSH plugin-market index for this package
// (spec: https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market).
//
// Usage: node scripts/update-market-index.mjs
// Lists every non-deprecated npm version that declares `dsh.bundle`. Versions
// already present in the existing index are preserved even when absent from
// the registry (e.g. an index published moments before `npm publish` lands).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const siteDir = join(root, 'site');
const outPath = join(siteDir, 'index.json');

const TITLES = { en: 'Claude Compat', zh: 'Claude 兼容桥' };
const ZH_DESCRIPTION =
  '把 Claude Code 的 .claude/ 目录（skills、commands、rules、agents、hooks、MCP）桥接进 DSH 原生技能注册表与规则注入。';

const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`);
if (!res.ok) throw new Error(`registry returned ${res.status}`);
const pack = await res.json();

const repoUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
if (!repoUrl.startsWith('https://')) throw new Error('package.json repository.url is not an https git URL');

// Existing index first: keeps entries the registry does not know about yet.
const listed = new Map();
const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { plugins: [] };
for (const v of prev.plugins.find((p) => p.name === pkg.name)?.versions ?? []) listed.set(v.version, v);

for (const [version, meta] of Object.entries(pack.versions)) {
  if (meta.deprecated || !meta.dsh?.bundle) continue;
  const time = pack.time?.[version];
  if (!time) throw new Error(`registry packument has no publish time for ${version}`);
  listed.set(version, { version, publishTimestamp: Math.floor(Date.parse(time) / 1000), source: { type: 'npm' } });
}

const versions = [...listed.values()].sort((a, b) => b.publishTimestamp - a.publishTimestamp);
if (versions.length === 0) throw new Error('no versions to list — refusing to write an empty market');

const index = {
  format: 1,
  title: TITLES,
  plugins: [
    {
      name: pkg.name,
      title: TITLES,
      description: { en: pkg.description, zh: ZH_DESCRIPTION },
      author: pkg.author,
      homepage: `${repoUrl}#readme`,
      repository: { url: repoUrl },
      versions,
    },
  ],
};

mkdirSync(siteDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n');
console.log(`wrote ${outPath}: ${versions.length} versions → ${versions.map((v) => v.version).join(', ')}`);

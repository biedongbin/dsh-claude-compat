# HANDOFF issue3 — 管理 skill（cc-plugin 等 5 个）目录可见但加载必失败

> 给在 `~/workspace_private/dsh-claude-compat` 新开会话的 AI（或人）。请先通读本文件再动手。
> 根因已定位、证据已复核、复现命令已验证，**无需重新调研**，按「修复规格」实现即可。
> 基线：main @ d36c5d9（v0.9.0），工作区干净（仅 .DS_Store/.omc 未跟踪）。

---

## 1. 现象（2026-10-28 实测）

DSH 会话（web profile，GUI）中：

- 技能目录里能看到 `cc-plugin` / `reload-cc-plugins` / `reload-skills` / `cc-resume` / `cc-export`（说明 provider 的 `list()` 正常）；
- 调 `skill` tool 加载 `cc-plugin` → **"Error: skill \"cc-plugin\" is unknown or no longer available"**（加载路径失败）；
- `~/.claude/plugins/**` 里找不到对应 SKILL.md —— 因为它们不是磁盘 skill，是 `src/index.js` 注册的 **inline candidate**。

## 2. 根因（证据链，已复核）

### 2.1 DSH registry 契约：加载只走 `provider.get(candidate)`

`node_modules/@deepseek-ai/dsh-skill/lib/index.js:250-266`（node_modules 是 symlink，实际落在 `~/.npm/_npx/1e7f6d9597241db0/...`，直接按仓库内路径读即可）：

```js
async get(name, options = {}) {
  ...
  const match = collected.entries.get(name);
  if (match === void 0) return void 0;
  const definition = await waitWithAbort(match.provider.get(match.candidate, options), options.signal);
  if (definition === void 0) return void 0;
  validateDefinition(definition);
  if (definition.name !== match.candidate.name) { this.invalidateEntry(match); return; }
  return definition;
}
```

- registry **永远调用 `provider.get(candidate)`**；candidate 自带的 `get` 闭包**不在契约内，永远不会被调用**。
- `SkillCandidate.locator` 的契约语义（`lib/types/index.d.ts:65`）："Opaque provider-owned handle passed back to `provider.get()`" —— locator 就是为回传给 provider 自己用的。
- `validateDefinition`（同文件 :471-489）强制：`content` 必须是 string（**没有 `body` 字段这一说**）、`name` 必须与 candidate.name 一致、`invocation`/`source`/`provider` 必填。
- `validateCandidate`（:452-470）强制 `candidate.provider === providerName`。

### 2.2 本插件的 bug

`src/index.js`（v0.9.0 行号）：

- `managerSkillCandidate()`（:267-279）：给 candidate 挂了 `get: async () => ({ name, description, body })` 闭包 + `locator: { kind: 'inline', path: import.meta.url }`；
- `reloadSkillDef()`（:238-265）：同构，且把 `this.control?.invalidate?.()` 副作用埋在闭包里；
- provider 的 `get(candidate)`（:295-318）**无条件走磁盘路径**：

```js
const locator = candidate.locator;
const raw = await readTextSafe(locator.path);   // :297
if (raw === undefined) return undefined;        // :298 → registry 报 unknown
```

`locator.path` = `import.meta.url` = `file:///Users/.../index.js`，是 URL 不是 fs path。`readTextSafe` 吞掉 ENOENT 返回 `undefined`（`src/lib.js:55-58`）→ provider.get 返回 `undefined` → registry `get()` 返回 `undefined` → skill tool 报 "unknown or no longer available"。

### 2.3 复现命令（已验证，输出如下）

```bash
cd ~/workspace_private/dsh-claude-compat
node -e "import('./src/lib.js').then(async m => {
  console.log(await m.readTextSafe('file://' + process.cwd() + '/src/index.js'));  // → undefined
  console.log((await m.readTextSafe(process.cwd() + '/src/index.js')).length);     // → 23530
});"
```

### 2.4 三个连带缺陷（同一根因）

1. **闭包返回字段名错**：`{ name, description, body }` —— `validateDefinition` 要求 `content`；即使闭包被调用也会 `TypeError: content must be a string` 抛出。
2. **reload 副作用永远不触发**：`reload-cc-plugins` / `reload-skills` 的 `control.invalidate()` 在闭包里，闭包永不被调 → 即使加载修好，reload 也不会真正刷新目录。
3. **就算把 URL 转成 path 也是错的**：provider.get 会把 index.js 整个源码（23KB JS）当 skill body 解析（无 frontmatter → `content = raw.trim()`）。正确做法是 inline 分流，不是修 path。

### 2.5 为什么测试没拦住

- `test/v060.test.js:84-98` 断言的是 **candidate 闭包被直接调用**（`list.find(...).get()`、断言 `def.body`）——把错误契约刻进了测试，真实 registry 从不走这条路；
- `test/self-check.test.js` 只对磁盘 skill（`shared`）走 `ctx.skills.get()` 加载断言（:114-117），**没有任何测试通过 registry 加载管理 skill**。

## 3. 修复规格

全部改动集中在 `src/index.js` + 两个测试文件。

### 3.1 `managerSkillCandidate()` 重写（body 进 locator，删闭包）

```js
managerSkillCandidate(name, description, whenToUse, body, { invalidate = false } = {}) {
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    provider: this.name,
    source: 'claude-compat-manager',
    rank: this.config.pluginManagerRank ?? 40,
    locator: { kind: 'inline', body, invalidate },
  };
}
```

### 3.2 `reloadSkillDef()` 收敛为复用（invalidate 走 locator 标记）

RELOAD 文案提为常量 `RELOAD_BODY`（原 :252-261 的模板串），然后：

```js
reloadSkillDef(name, description) {
  return this.managerSkillCandidate(name, description, undefined, RELOAD_BODY, { invalidate: true });
}
```

### 3.3 provider `get(candidate)` 开头分流 inline（核心）

```js
async get(candidate) {
  const locator = candidate.locator;
  if (locator?.kind === 'inline') {
    if (locator.invalidate) {
      try { this.control?.invalidate?.(); } catch { /* best-effort */ }
    }
    return {
      name: candidate.name,
      description: candidate.description,
      ...(candidate.whenToUse !== undefined ? { whenToUse: candidate.whenToUse } : {}),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: this.name,
      content: locator.body,
    };
  }
  // ↓ 原磁盘路径保持不动（locator.path / parseFrontmatter / renderAgentContent）
  const raw = await readTextSafe(locator.path);
  ...
}
```

要点：
- 返回的 `name` 必须 === `candidate.name`（registry :259-263 会校验，不一致则 invalidateEntry + 返回空）；
- `path` / `resourceBase` 可选，inline 不给，合法；
- 删除两处 `path: import.meta.url`（file:// URL 永远是坑）。

### 3.4 测试改造

1. **重写 `test/v060.test.js:84-98`**：不再调 `candidate.get()`。改为走真实 registry 通道：
   - `const def = await ctx.skills.get('reload-cc-plugins', { cwd: project })`（或无 cwd，按该测试现有 fixture 语义）
   - 断言 `def.content`（不是 `.body`）包含 `'reloaded'`；
   - 断言 `def.provider === 'claude-compat'`；
   - invalidate 断言：看该测试现有 fake `control` 怎么注入（provider 构造时传入），记录 invalidate 调用次数，加载 reload skill 后 +1；加载 `cc-plugin` 后不 +1。
2. **`test/self-check.test.js` 补一条加载断言**（:114 附近，紧挨 `shared` 的加载验证）：
   ```js
   const mgr = await ctx.skills.get('cc-plugin', { cwd: project });
   assert.equal(mgr.provider, 'claude-compat');
   assert.ok(mgr.content.includes('Plugin Manager'));
   ```
3. 两处硬编码 skill 名列表（:105、:122）**不用改** —— skill 集合没有增减（这是 docs/HANDOFF.md 教训 #7 的反向确认）。
4. `npm run check` 必须全绿。

### 3.5 可选顺手项（独立小 commit，别混进主修复）

- `src/plugin-manager.js` HELP 文案（:33-56）通篇 `/plugin`，实际技能名是 `/cc-plugin`（:40 自己也写了 "invoked as /cc-plugin <args>"）。统一为 `/cc-plugin`。
- `runPluginCommand` 目前无任何执行挂载（没有 DSH tool 会调它），body 只是文档。可考虑在 body 里明确指示模型用 bash 跑 `claude plugin ...`。不阻塞本修复。

## 4. 部署与真机验证（必须做全）

**部署漂移警告**：`~/.dsh/profiles/web/node_modules/dsh-claude-compat` 当前是 **0.7.0 旧拷贝**（缺 `aliases.js`、`cc-export-skill.mjs`，index.js 也是旧版）。改源码不影响运行中的 DSH —— 插件在进程启动时 import。

```bash
# 1. 测试
npm run check

# 2. 部署到 web profile（GUI 会话用的 profile；desktop 在用的话也跑一遍）
bash scripts/deploy-local.sh --profile web

# 3. 完全重启 DSH 进程（不是刷新窗口）
```

真机验证清单（新 DSH 会话内）：

1. `skill` tool 加载 `cc-plugin` → 返回 `<skill_content>`，body 是 PLUGIN_SKILL_BODY（"Claude Code Plugin Manager (dsh-claude-compat)"）；
2. 加载 `reload-cc-plugins` → 返回 "Catalog reloaded ✅" 文案；
3. `/reload-cc-plugins` 后新装/删除的 Claude 插件 skill 能在当前会话目录中出现（invalidate 生效）；
4. 回归：磁盘 skill 仍正常（`shared` 类加载不受影响）。

## 5. 环境事实速查

| 项 | 值 |
|---|---|
| 仓库 | `~/workspace_private/dsh-claude-compat`，main @ d36c5d9，v0.9.0，干净 |
| DSH registry 契约源 | `node_modules/@deepseek-ai/dsh-skill/lib/index.js`（get :250-266、validateCandidate :452、validateDefinition :471）+ `lib/types/index.d.ts`（SkillProvider :168-188） |
| 运行中的部署拷贝 | `~/.dsh/profiles/web/node_modules/dsh-claude-compat`（0.7.0，stale） |
| 部署脚本 | `scripts/deploy-local.sh`（rsync --delete src/，自动备份，改完必须重启 DSH） |
| DSH app | `/Applications/DeepSeek Harness.app`（核心代码在 app.asar 内，runtime-context 给的 `app.asar.dsh/` 路径实际不存在，别去找） |
| 受影响 skill（5 个） | `cc-plugin`、`reload-cc-plugins`、`reload-skills`、`cc-resume`、`cc-export`（均 inline，全部加载必败） |

## 6. 本次会话已完成的排查（勿重复）

- 已确认 skill 目录 list() 正常、加载失败；
- 已定位 `cc-plugin` 由本插件 inline 注册（非 `~/.claude/plugins` 磁盘 skill）；
- 已读契约源码并核实调用路径（provider.get 是唯一加载通道）；
- 已用 node 单行复现 `readTextSafe(file:// URL) → undefined`；
- 已核对 `validateDefinition` / `validateCandidate` 的必填字段。

## 7. 边界与注意

- 不要试图"把 file:// URL 转成 path"来修 —— 那会把 index.js 源码当 body（见 2.4 #3）；
- 不要给 inline locator 补 `path`/`resourceBase` —— 契约里均可选，多余字段反而误导；
- `reloadSkillDef` 的 invalidate 必须在 provider.get 分支里执行（加载即刷新），不能留在 list()（会每轮目录收集都触发，等于自废缓存）；
- commit 拆两个：主修复（src + 测试）一个，HELP 文案一个。

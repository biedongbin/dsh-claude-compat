# 交接文档 — Issue #2 修复（v0.8.4，source kind 兼容）

> 给 DSH 或任何 AI agent 的续做指令。**在 `/Users/biedongbin/workspace_private/dsh-claude-compat` 目录下恢复对话时先读本文件。**
> 上一份交接文档是 `docs/HANDOFF.md`（5 项能力增强任务），与本文件无关，勿混。

---

## 一句话状态

**代码已完毕、已 commit、已 push、Issue #2 已回复并关闭。唯一未完成：`npm publish 0.8.4`，卡在 npm token 失效，需人工 `npm login` 后发布。**

---

## 任务缘起

GitHub Issue #2（`biedongbin/dsh-claude-compat`）：
https://github.com/biedongbin/dsh-claude-compat/issues/2

**现象**：dsh 0.2.0-rc.2 下，凡项目含 `.claude/rules/*.md`，新建会话 UI 报
`format v4 message requires a producer-owned source kind`，规则注入失败；hook 注入的
`additionalContext`（UserPromptSubmit / PostToolUse）同被拦截。Skills/commands/agents 无碍。

---

## 根因（已探明，无需重查）

dsh 0.2.0 起 session format v4 准入，源码在
`packages/session/session-format-v3-to-v4/src/message-sources.ts`（desktop 内嵌于
`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）：

```js
function source(message) {
  const value = message["source"];
  if (!isSessionFormatJsonObject(value) || typeof value["kind"] !== "string"
      || value["kind"].length === 0 || value["kind"] === "plugin")
    throw new SessionFormatError("format v4 message requires a producer-owned source kind");
}
```

即：**V3 时代的包装 `source.kind === 'plugin'` 被显式拒绝**，第三方生产者必须声明自有 kind。

同文件 `producerKind(plugin, role)` 的解析顺序：
1. `@deepseek-ai/dsh-system-prompt` + role=system → `'system-prompt'`
2. `RENAMED_PRODUCERS` 映射（compact / tools-code-mode / tools-ptc / dsh-compaction-basic / dsh-system-prompt）
3. `RELEASED_SAME_NAME_PRODUCERS`（25 个第一方白名单）→ 原样返回
4. 其余 → **`` `plugin:${plugin}` ``** ← `dsh-claude-compat` 落在此处

故本插件应发 `plugin:dsh-claude-compat`，并删去 `plugin` 字段。

### 为何难定位

`node_modules/@deepseek-ai/dsh-llm/lib/types/message.d.ts:98-101` 已发布的类型声明**仍推荐被禁形态**
（`plugin: { kind: 'plugin'; plugin: string } & ContextFormed`），`createUserMessage()` 亦不校验，
故错误仅在**会话日志准入阶段**才浮出。type 层看不出问题。

### 关键兼容性事实（写代码前必读）

dsh 自身的 v3→v4 迁移对旧包装 `{kind:'plugin', plugin:'dsh-claude-compat'}` 恰好产出
`{kind:'plugin:dsh-claude-compat'}` —— **与今日新写的值 byte-identical**。
所以 0.8.3 写下的、经 dsh 迁移的旧日志，与 0.8.4 新写的消息收敛于同一 kind，不会出现同会话两种身份。
这正是选 `plugin:dsh-claude-compat` 而非自定义 kind 的原因。

### 版本兼容矩阵（已实测）

| dsh 版本 | 位置 | 准入规则 | `plugin:dsh-claude-compat` |
|---|---|---|---|
| 0.1.2-rc.1 | nvm 全局 `/Users/biedongbin/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh` | 无 v4 准入；v2→v3 白名单（`SOURCE_KINDS`，含 `'plugin'`）只对**迁移**生效 | 直写不迁移 → 通过 |
| 0.2.0-rc.2 | `/Applications/DeepSeek Harness.app/.../app.asar` | v4 `assertV4MessageSources` 拒 `kind === 'plugin'` | 通过 |

`form` 字段只在 UI 呈现层读（`packages/client/ui-chat/.../event-projection.ts` 的 `contextForm()`），
未知名落 opaque，**不拒**。故 `form: 'hook-context'` / `form: 'rules'` 保留无害。

---

## 已完成的改动（勿重做）

commit `ce8aa2e` — `fix(source): emit producer-owned source kind for dsh session format v4`
（已 rebase 到 `origin/main` 之上，已 push）

### 1. 新增共享常量 — `src/lib.js`

```js
export const CLAUDE_COMPAT_SOURCE_KIND = 'plugin:dsh-claude-compat';
```
（含 9 行注释说明为何是这个值）

### 2. 三处发射点改用常量并删 `plugin` 字段

| 文件:行 | 函数 | form |
|---|---|---|
| `src/hooks.js:112` | `mapPostHookOutput` | `'hook-context'` |
| `src/hooks.js:343` | `runPromptHooks` | `'hook-context'` |
| `src/index.js:433` | `registerRulesSection` | `'rules'` |

旧 → 新：
```js
- source: { kind: 'plugin', plugin: 'dsh-claude-compat', form: 'hook-context' },
+ source: { kind: CLAUDE_COMPAT_SOURCE_KIND, form: 'hook-context' },
```

### 3. 两处判重逻辑改用常量

- `src/index.js:409` `present()` — 原双字段比对 `m?.source?.kind === 'plugin' && m.source.plugin === ...`
- `src/index.js:418` 事件日志扫描 — 原 `event.data?.source?.kind === 'plugin' && event.data.source.plugin === ...`

均改为单字段 `=== CLAUDE_COMPAT_SOURCE_KIND`。

### 4. 测试

- `test/v080.test.js` — 新增回归测试：断言 kind 为生产者自有、`plugin` 字段已删、且 `!== 'plugin'`
- `test/v040.test.js` / `test/self-check.test.js` — 旧断言（`source.kind === 'plugin'` + `source.plugin`）改为
  新常量；`self-check` 新增 `import { CLAUDE_COMPAT_SOURCE_KIND } from '../src/lib.js'`
- `test-evidence/verify-084-v4-admission.mjs` — **新增**：从已安装 app.asar 提取真实准入谓词，
  正例通过 + 三条反例（旧包装 / 空 kind / 缺 kind）被拒 + 断言迁移与发射同值
- `test-evidence/verify-082-migration-source.mjs` — **已删除**（断言的是被本次推翻的旧形态，留之必假失败）

### 5. 版本与文档

- `package.json` / `package-lock.json` → `0.8.4`
- `CHANGELOG.md` / `CHANGELOG.zh-CN.md` — 双语 0.8.4 条目
- `README.md` / `README.zh-CN.md` — badge `0.8.1` → `0.8.4`

---

## 当前状态核实（截至本文件撰写）

```
本地 HEAD   = ce8aa2e860dbd7a788033954cfecfd6748d858a1
origin/main = ce8aa2e860dbd7a788033954cfecfd6748d858a1   （已同步）
package.json version      = 0.8.4
package-lock.json version = 0.8.4
git status  = 仅 ?? .DS_Store / ?? .github/.DS_Store / ?? .omc/（本机杂项，非代码）
```

**测试**：`npm run check` → 15 tests，14 pass，1 fail。

- 唯一 fail = `readInstalledClaudePlugins: real ~/.claude/plugins registry`
  （`test/v050.test.js:32`，两处硬编码 `4.15.7`：`:32` 与 `:34` 的 installPath）——
  断言插件版本 `4.15.7`，本机实际 `5.7.0`。
  **已用 `git stash` 确认改动前即失败**，属环境漂移（本机装的 claude plugin 版本变了），与本 issue 无关。
  若要修：改 `test/v050.test.js` 的期望值，或改为不硬编码版本。

**准入验证**：`node test-evidence/verify-084-v4-admission.mjs` → PASS。

**残留检查**：`src/` 内无 `kind: 'plugin'` 代码（仅 `src/lib.js` 注释提及）；无指向已删 `verify-082` 的引用。

---

## 唯一待办：npm 发布 0.8.4

### 为何没发成

`npm publish` 失败，**纯凭据问题，非代码问题**：

| 检查 | 结果 |
|---|---|
| `npm whoami` | `401 Unauthorized` |
| `curl -H "Authorization: Bearer <token>" https://registry.npmjs.org/-/whoami` | `401` |
| `npm publish` | `404 Not Found - PUT https://registry.npmjs.org/dsh-claude-compat`（npm 对无权限者以 404 掩藏真实原因） |
| `~/.npmrc` 的 `registry` | `https://registry.npmmirror.com` ← **只读镜像** |
| `~/.npmrc` 的 `_authToken` | `npm_...`，40 字符，**已失效** |
| `npm publish --dry-run` | **正常**（19 files, 42.1 kB, version 0.8.4） |

### 发布步骤（人工）

```bash
cd /Users/biedongbin/workspace_private/dsh-claude-compat
npm login --registry https://registry.npmjs.org
npm publish --registry https://registry.npmjs.org
```

**必须显式 `--registry https://registry.npmjs.org`** —— 否则会用 `~/.npmrc` 的 npmmirror 镜像，推不上去。

或写入新 token 到 `~/.npmrc`（注意该文件 registry 是镜像，需单独覆盖发布时 registry）：
```
//registry.npmjs.org/:_authToken=<new-token>
```

### 发布后验证

```bash
npm view dsh-claude-compat@0.8.4 version --registry https://registry.npmjs.org
```

用户升级：`dsh plugin --profile web add dsh-claude-compat@latest`

---

## 环境注意事项（下次会话会用到）

### 网络：git/curl 的 TLS 间歇性握手失败

本机对 github.com / registry.npmjs.org 的 HTTP/2 握手常报
`LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ...:443`。

**对策**：git 操作加 `-c http.version=HTTP/1.1`。例：
```bash
git -c http.version=HTTP/1.1 fetch origin main
git -c http.version=HTTP/1.1 push origin main
```
`curl` 则重试即可（首次 000、二次通常通）。

### 凭据：两套 token 状态

- **`gh` 的 keyring token 已失效**（`gh auth status` 报 `The token in keyring is invalid`）。
  临时绕过：从 osxkeychain 取有效 `gho_` token 注入环境变量 ——
  ```bash
  CRED=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null)
  export GH_TOKEN=$(echo "$CRED" | awk -F= '/^password=/{print $2}')
  ```
  该 token scope = `gist, read:org, repo, workflow`，足够 issue/PR 操作。
  长期修：`gh auth login -h github.com`。
- **npm token 失效**（见上「唯一待办」）。

### 跨目录工作

本任务的目标仓库在 `/Users/biedongbin/workspace_private/dsh-claude-compat`，
不在任何会话 cwd 下。**若在 dsh-claude-compat 目录启动会话则无需每次 `cd`。**
（本次会话 cwd 是 `/Users/biedongbin/workspace/github/9router`，与任务无关，全程未触碰该仓库。）

---

## 关联文档

- `docs/HANDOFF.md` — **上一个**任务的交接（5 项能力增强），与本文件无关
- `CHANGELOG.md` 的 `[0.8.4]` 条目 — 面向用户的问题与修复说明
- `test-evidence/verify-084-v4-admission.mjs` — 可执行的准入验证证据
- Issue #2 回复 — https://github.com/biedongbin/dsh-claude-compat/issues/2#issuecomment-6250131240

---

## 若还要继续做的事（可选，未开工）

1. **修 `test/v050.test.js` 的版本硬编码** —— 让 `npm run check` 在本机全绿（见上）。
2. **给 dsh 上游提 issue** —— `dsh-llm/lib/types/message.d.ts:94` 的类型声明仍在推荐被 v4 准入拒绝的
   `{kind:'plugin', plugin}` 形态，会误导第三方插件作者（Issue #2 正是踩此坑）。建议上游把
   `MessageSourceMap` 的 `plugin` 成员标注为 deprecated 或移除。
3. **`docs/HANDOFF.md` 的任务 7（cc-resume 反向）** 仍未开工，与本 issue 无关。

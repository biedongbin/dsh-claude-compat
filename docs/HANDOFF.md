# dsh-claude-compat 增强任务交接文档

> 给 DSH（或任何 AI agent）的续做指令。请先读本文件，再按「待办任务」逐个推进。
> 已探明的技术事实已写入，**无需重新调研**，直接基于结论实现。

---

## 背景

本仓库 `dsh-claude-compat` 是一个 DSH (DeepSeek Harness) 插件，把 Claude Code 的 `.claude/` 配置桥接进 DSH。本次目标是**增强插件能力**，共 5 项任务。

**已探明的 DSH 平台事实（关键，写代码前必读）：**

1. DSH skill 类型定义在 `node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts`：
   - `SkillCandidate` 有 `name`/`description`/`whenToUse`/`invocation`/`rank`/`locator`/`path`/`metadata`
   - `SkillDefinition.content` 是 markdown body，`metadata` 是 frontmatter
   - **`skill` 工具 schema 只有 `name` 一个参数，没有 arguments 通道** —— `$ARGUMENTS` 无法透传
2. DSH 事件名（`grep` 自 `dsh-agent/lib`）：`agent/session-start`、`agent/disposed`、`agent/created`、`agent/pre-step`、`tools/pre-execute`、`tools/post-execute`。**无 `agent/notification` 事件**
3. DSH 原生 skill 存储：`<projectRoot>/.dsh/skills/<name>/SKILL.md`
4. DSH **没有**自己的 MCP 配置源 —— `.mcp.json`（Claude 格式）是唯一真实来源，本插件读它转成 `dsh-mcp-client`
5. DSH 会话日志：`~/.dsh/sessions/<munged-cwd>/session-cc-<id>/session.jsonl.zstd`，zstd 压缩，头部行单独一个 frame
6. 管理 skill 通过 `this.managerSkillCandidate(name, description, whenToUse, body)` 注册，body 从 `src/<name>-skill.mjs` 导出
7. 测试：`npm run check`，fixture 内联在 `test/*.test.js`。**新增管理 skill 必须同步更新 `test/self-check.test.js` 里两处硬编码的 skill 名列表**（第 ~104、~121 行）

---

## 任务总览

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| 2 | hooks 补全 | ✅ 完成 | SessionStart/SessionEnd 已实现；Notification 无 DSH 事件，暂不支持 |
| 5 | /cc-export 导出 | ✅ 完成 | 已实现 + 测试通过 |
| 4 | commands 参数解析 | ❌ 平台限制 | DSH skill 工具无 arguments 通道，无法实现 |
| 9 | .mcp.json 双向同步 | ❌ 平台限制 | DSH 无自有 MCP 配置源，天然单向 |
| 7 | cc-resume 反向 | ⏳ 待办 | 技术上可行，工程量大 |

**已完成的改动（2 + 5）在 git 工作区，未提交。** 续做前可先提交：`git add -A && git commit -m "feat: hooks 补全 + /cc-export 导出"`。

---

## 已完成任务详情（勿重做）

### 任务 2 — hooks 补全（已完成）
- 文件：`src/hooks.js`
- 改动：`EVENTS` 表新增 `SessionStart: 'session-start'`、`SessionEnd: 'session-end'`
- 新增 `sessionStartPayload` / `sessionEndPayload` 函数
- `registerHooks` 尾部新增 `agent/session-start`（跑 startHooks）和 `agent/disposed`（跑 endHooks）监听，fire-and-forget，非零退出仅告警
- **Notification hook**：DSH 无 `agent/notification` 事件，未实现（保留在注释说明）

### 任务 5 — /cc-export（已完成）
- 新增 `scripts/cc-export.mjs`：`list` / `export [--overwrite] [--target]` 子命令，读 `.dsh/skills` 导出 `.claude/skills/<name>/SKILL.md`，frontmatter 保留，纯 body 自动补全
- 新增 `src/cc-export-skill.mjs`（导出 `CC_EXPORT_SKILL_BODY`）
- `src/index.js`：在 `cc-resume` 后注册 `cc-export` 管理 skill
- `test/self-check.test.js`：两处 skill 名列表加 `'cc-export'`（已更新）
- 自测：`/tmp/cc-export-test` 造 fixture 验证通过，`npm run check` 全绿

---

## 待办任务

### 任务 7 — cc-resume 反向（DSH 会话 → Claude Code）

**目标**：把 DSH 会话导入 Claude Code 格式，与现有 `scripts/cc-resume.mjs`（Claude→DSH）形成双向闭环。

**技术要点（已探明）：**
- DSH 会话源：`~/.dsh/sessions/<munged-cwd>/session-cc-<id>/session.jsonl.zstd`
  - 路径 munge：DSH 是 `-<path with / 替换为 ->--`（前后各多一个 `-`），Claude 是 `-<path>/`（无前导 `-`）
  - zstd 格式：头部行 + events，各自独立 zstd frame。解压用现有 `scripts/zstd-compat.mjs` 的 `zstdFramesSync`（读它看双向用法）
- DSH event schema（`buildDshEvents` 已展示了生成逻辑，反向即解析）：`user/message`、`assistant/message`（含 `tool_use` 块）、`tool/result`、`turn/start`、`turn/end`、`step/start`、`step/end`、`session/title`
- Claude 目标格式：`~/.claude/projects/<munged-cwd>/<sessionId>.jsonl`，每行一个 JSON，类型 `user`/`assistant`，`message.content` 为 text / tool_use / tool_result 块
- **必须用 `zstd` 二进制**（macOS：`brew install zstd`）

**建议实现：**
1. 新增 `scripts/cc-resume-export.mjs`（或扩展现有脚本加 `export` 子命令），子命令 `list-dsh` / `export-dsh`
2. `list-dsh`：扫 `~/.dsh/sessions/*/session-cc-*`，列出 id、cwd、消息数、标题
3. `export-dsh`：解压 zstd → 解析 DSH events → 转 Claude JSONL → 写 `~/.claude/projects/<cwd>/cc-dsh-<id>.jsonl`
4. 注册 `/cc-resume-export` 管理 skill（照抄 `src/cc-export-skill.mjs` 模式）
5. 更新 `test/self-check.test.js` 两处 skill 名列表

**测试**：造一个最小 DSH 会话 fixture（可复用 `buildDshEvents` + `writeDshSession` 生成，再反向解析），断言往返一致。

---

## 已放弃任务（平台限制，若 DSH 未来支持可重开）

### 任务 4 — commands `$ARGUMENTS` 参数透传
DSH `skill` 工具 schema 只有 `name`，无 arguments 通道，`$ARGUMENTS` 会作为字面文本进 prompt。无法实现。

### 任务 9 — `.mcp.json` 双向同步
DSH 无自有 MCP 配置源，`.mcp.json` 是唯一来源，天然单向。无反向可同步。

---

## 通用规则

- 所有新增用户可见字符串需走 i18n（`core/i18n.go` 是 Claude 侧；本 DSH 插件用 `slog`/`console.log`，保持与现有代码一致即可）
- 改动后必须 `node --check` 每个改动的 .js/.mjs，再 `npm run check` 全绿
- 新增管理 skill 必须同步 `test/self-check.test.js` 两处硬编码 skill 列表
- 提交时保留 Co-Authored-By 尾部

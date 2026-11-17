# 需求 Review：Claude 加载内容总览页 + 侧边栏入口 + 启停开关（2026-11-13）

> 目标版本建议：v1.3.0。本文档是需求评审 + 优化建议，不是实现。

---

## 1. 现状盘点（调研结论）

### 1.1 本插件已有能力（v1.2.1）

| 能力 | 现状 |
|---|---|
| Skills / Commands / Agents 桥接 | `src/index.js` skill provider：项目 `.claude`（rank 50）> DSH 原生（600）> `~/.claude`（700）> 插件（750） |
| Rules 注入 | `.claude/rules/*.md` + `~/.claude/rules/*.md`，每会话一条 system-reminder，同名项目优先 |
| Hooks | `.claude/settings.json` 的 PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/SessionEnd 桥接 |
| MCP | managed-mcp.json / .claude.json / .mcp.json（+ opt-in 插件 MCP），进程级挂载，变更需重启 |
| 插件管理 UI | `src/client.js` 已注册 `plugins.tab`（DSH「插件」页里的 "Claude Code" 标签页），含 已安装/发现/市场/会话/状态 五个子页 |
| 总量级信息 | 仅 `status` action 返回 features 布尔开关（enableSkills 等 5 个全局配置项），**无逐条清单** |
| 热刷新 | `provider.control.invalidate()` + `/reload-cc-plugins`，已具备——开关切换后可即时生效，无需重启（MCP 除外） |

### 1.2 DSH 平台 UI 扩展点（cordis inspect 实测确认）

| Slot | 用途 | 与本需求关系 |
|---|---|---|
| `sidebar.panellist`（list, root） | 左侧栏图标列——即截图中红框区域（插件/自动化任务/更多） | **新菜单入口落点**，replaceRisk=none，官方支持 |
| `main`（keyed, root） | 中央面板，按 sidebar entry id 选择 | **新页面落点**（新 key，不遮蔽 conversation） |
| `ctx.layout.selectPanel(panelId)` | 编程切换面板 | 打开新页面 |
| `plugins.tab` / `plugins.detail.section` 等 | DSH 原生插件页的扩展位 | 现有 Manager 已占用 `plugins.tab` |
| `settings.plugins.tab` | 设置-插件页的子页 | 备选落点（不推荐，见 §3.1） |

结论：**需求在现有插件体系内完全可实现**，不需要 fork shell。

---

## 2. 需求复述（已与用户确认）

1. 侧边栏红框区域新增一个菜单项（独立入口，非 DSH 插件页内标签）。
2. 新页面：罗列本会话从 Claude 侧实际加载的全部内容——skills、commands、rules、plugins（含 marketplace 来源），一目了然；hooks / agents / MCP 一并展示。
3. 每个插件 / skill 一个「DSH 内是否启用」开关，**默认全开**，持久化到项目记忆。
4. 开关作用域（用户已确认）：主开关只影响 DSH 会话内注入；另拓展两个动作——**回写 Claude**（写入 Claude 侧禁用配置）与**物理移除**（删除文件 / 卸载插件，危险操作）。
5. command / rule 仅展示，不加开关。

---

## 3. 需求优化建议（按优先级）

### P0-A 入口与页面：用 `sidebar.panellist` + `main` 双注册，而非塞进设置页

- 侧边栏注册一个图标 + label（"Claude 桥接"），`main` 注册同 key 面板；点击走 `selectPanel`。
- **同时保留**现有 `plugins.tab`（DSH 插件页标签）作为轻量入口，页面组件复用同一个 React 树，避免两套 UI 漂移。
- 建议：新页首屏 = 汇总卡片（各类目计数 + 全局 features 开关）+ 分类 tab（技能 / 命令 / 规则 / 插件 / Hooks / Agents / MCP），复用现有 `dcc-*` 样式与 i18n 字典（`locale/` 双语已有机制）。

### P0-B Inventory 数据协议：新增 `inventory.list` action，逐条带元数据

现有 `status` 只有布尔，需要新 action 返回逐条数据。每条建议字段：

```
{ id, kind: 'skill'|'command'|'agent'|'rule'|'plugin'|'hook'|'mcp',
  name, description, source: 'project-claude'|'user-claude'|'claude-plugin',
  path, rank, enabledInDsh: bool, claudeState?: 'enabled'|'disabled'|'removed' }
```

- 数据源全部现成：provider 的 candidate 扫描、`readInstalledClaudePlugins`、rules 文件列表、hooks 配置解析——只需聚合，不需要新扫描逻辑。
- **优化点**：清单要标注「同名冲突裁决结果」（rank 决胜负），被 DSH 原生同名项压掉的条目应显示"已生效/被覆盖"，这是排错时最有价值的信息，Claude Code 原生 UI 也没有。

### P0-C 开关持久化：项目级状态文件，而非 Cordis Config

- 落点建议 `<projectRoot>/.claude/dsh-state.json`（跟 Claude 配置同目录，语义"这个项目的 Claude 桥接状态"；或 `.dsh/claude-compat-state.json`，跟 DSH 原生根目录走——二选一，倾向后者，避免污染用户 Claude 目录）。
- 结构：`{ disabled: { "user-claude:skill-name": true, "claude-plugin:plugin-x": true } }`，key 用 `source:id` 防跨来源同名冲突。
- 生效路径：provider.list() / rules 注入 / hooks 注册 / pluginMcpServers 处**读该文件过滤**；切换后调 `control.invalidate()` 热刷新（MCP 与 hooks 仍需重启，页面上沿用现有 restart 提示）。
- **默认全开 = 文件不存在或条目缺失即启用**，这样零配置零惊喜，也天然向后兼容。

### P1-A 「回写 Claude」与「物理移除」：二级危险区 + 二次确认，分阶段实现

- **回写 Claude**（中危）：对 skill/command/agent → 移动文件不可取；正确姿势是利用 Claude Code 自身的禁用机制（如插件 `enabled: false`、settings 层面的开关）。skills 属于文件系统级内容，Claude 没有按 skill 禁用的配置——**建议回写动作第一版只覆盖 plugin 与 MCP**（有官方 disable 语义），文件型内容先只做 DSH 侧开关，UI 上标"回写不可用（原因）"。
- **物理移除**（高危）：skill/rule 文件 → 移入回收目录（如 `.claude/.dsh-trash/<date>/`）而非直接 unlink，可恢复；插件 → 复用现有 `plugins.uninstall` 通道。
- 两类操作必须：独立 confirm 文案 + 操作前快照记录（谁、何时、动了什么，写入状态文件的 `audit` 数组）+ 页面提供"恢复"入口（trash 内条目可见）。

### P1-B 展示体验优化

- 搜索框 + source/rank 筛选（复用现有 `dcc-toolbar` 模式）；条目数会很大（本项目 skill 目录 600+），必须分页（现有 Pagination 组件直接复用）。
- skill 条目点击展开：description + whenToUse + 路径 + 生效 rank，**不预载 body**（与 provider 的懒加载契约一致）。
- 空态与权限：沿用「仅 DSH 所有者可管理」的现有权限文案。

### P2 可选增强（本轮不做，仅记录）

- 批量操作（按 source 批量禁用 `~/.claude` 全部——最常见诉求："user 级太吵"）。
- 开关变更对会话上下文的影响提示（估算节省的 system-reminder token 量，rules 尤其明显）。
- MCP 逐服务器开关（当前只有全局 enablePluginMcp）。

---

## 4. 风险与边界

| 风险 | 对策 |
|---|---|
| `main` slot replaceRisk=shadows-shipped-ui | 新 key 注册属增量，不覆盖 conversation；仍需在真实 GUI 验证（`pnpm run dev:web` + 刷新） |
| 状态文件与并发会话 | 状态文件读写加进程内互斥；多 DSH 进程同项目属既有问题，不在本轮扩大 |
| 物理移除误删 | 回收目录 + audit + 恢复入口三重兜底；第一版可先只上"移入回收站"语义 |
| skill 目录巨大导致清单慢 | 复用 provider 现有懒发现（name+description only），分页 + AbortSignal，已有模式 |
| 测试 | `test/self-check.test.js` 若新增管理 skill 需同步硬编码清单；inventory action 需新增 fixture 测试 |

## 5. 建议排期（里程碑）

1. **M1（核心）**：`sidebar.panellist`+`main` 入口 → `inventory.list` action → 清单页（含冲突裁决标注）→ DSH 侧开关 + 状态文件 + 热刷新。
2. **M2（治理）**：回写 Claude（plugin/MCP 先行）→ 回收站式移除 + audit + 恢复。
3. **M3（体验）**：批量开关、token 影响提示、MCP 逐服务器开关。

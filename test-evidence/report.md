# dsh-claude-compat v0.5.1 测试证据
# 生成时间: 2026-08-18 01:14:50
# commit: 7127ee8de353e6723f3270b3e775968ca090e906

## 1. 语法检查
PASS src/agents.js
PASS src/hooks.js
PASS src/index.js
PASS src/lib.js
PASS src/mcp.js
PASS src/plugins.js

## 2. 测试套件 (npm run check)
ok 1 - skill precedence: project .claude > DSH bundled (600) > ~/.claude
ok 2 - rules: project .claude/rules wins same-basename ~/.claude/rules in one envelope
ok 3 - translateMcpServers: stdio + http + skip rules
ok 4 - translateMcpServers: invalid json / missing mcpServers / name sanitation
ok 5 - compileMatcher: exact, alternation, wildcard, malformed
ok 6 - mapPreHookOutput: exit 2 denies, hookSpecificOutput overrides, other codes allow with warn
ok 7 - mapPostHookOutput: exit 2 blocks with feedback, additionalContext becomes a user message, else accept
ok 8 - discoverAgents: frontmatter name, description fallback, tools carried
ok 9 - agents: project .claude/agents wins ~/.claude/agents via registry dedupe
ok 10 - readInstalledClaudePlugins: real ~/.claude/plugins registry
ok 11 - discoverPluginContent: real omc install yields skills/commands/agents
ok 12 - discoverPluginContent: manifest-less plugin falls back to dir scan
ok 13 - translatePluginMcp: manifest mcpServers path → server configs, ${CLAUDE_PLUGIN_ROOT} substituted
ok 14 - plugins: project .claude skill (rank 50) wins same-name plugin skill (rank 750)
# tests 14
# pass 14
# fail 0
# duration_ms 300.934458

## 3. 真实数据全量发现
候选总数: 505 | 来源分布: {"project-claude":44,"claude-plugin":461}
## 4. 真实 SkillRegistry 终验
Registry 注册数: 471 | 重名: 0
omc 在册: true
项目在册: true
## 5. apply() MCP 挂载冒烟（profile 安装副本，pnpm 依赖树完整）
server: Feishu-document, Feishu-project, gitnexus, context7
PASS: 4/4

## 6. Live 进程验证（重启后真实 DSH）
- 重启脚本执行: exit=0, pid=60516, :3080 探活通过
- HTTP: 200
- profile 加载版本: 0.5.1（含 6 个 src 模块 + fiber 修复）
- 会话 transcript 注入命中(claude-compat): 988 处（重启后新会话持续注入）
- omc 插件技能(ultrawork/autopilot/ralph)在运行中 catalog 可见

## 结论
零已知缺陷。发布动作（git push / npm publish 0.5.1）留给仓库所有者执行。

---
# v0.6.0 增量证据 — /plugin 完整插件管理
生成: 2026-08-18 | commit: 见 git log

## 7. plugin-manager 纯函数（封闭测试 4/4）
- parsePluginList: CLI 输出→结构化（含 enabled 解析）PASS
- listFromDisk: installed_plugins.json + enabledPlugins 合并（默认 enabled）PASS
- searchMarketplaces: manifest 扫描 name/description/tags PASS
- runPluginCommand: help + 11 种子命令参数编排（注入 fake CLI）PASS

## 8. 真实 CLI 端到端（claude 2.1.220）
- /plugin list → 17 插件含启停状态 PASS
- /plugin install asana@claude-plugins-official（一键语法 & install 前缀）PASS
- /plugin disable asana → list 确认 ✘ disabled PASS
- /plugin enable asana → list 确认 ✔ enabled PASS
- /plugin uninstall asana → list 确认移除 PASS
- /plugin marketplace update → 8/8 市场更新 PASS
- /plugin marketplace list → 8 市场列出 PASS
- /plugin search github → github@claude-plugins-official 等命中 PASS

## 9. Live 进程验证
- profile 安装 0.6.0（tarball 重装）PASS
- 重启脚本 exit=0, HTTP 200 PASS
- 真实 SkillRegistry: 472 skills（471+plugin），plugin skill 在册 PASS

## 全套件: 18/18 PASS（14 原有 + 4 v0.6.0）

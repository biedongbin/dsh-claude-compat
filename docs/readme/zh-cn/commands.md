[← 项目首页](../../../README.zh-CN.md) · [English](../en/commands.md)

# 内置命令

安装本插件后可使用五个原生管理命令：

| 命令 | 作用 |
|---|---|
| `/cc-plugin` | 打开插件管理界面，或使用 `list`、`install <名>[@市场]`、`uninstall`、`enable`、`disable`、`update [名]`、`search <词>`、`marketplace list\|add\|remove\|update`。`/cc-plugin <名>@<市场>` 可直接安装。变更要求 `claude` CLI，并使用用户作用域；CLI 缺失、认证或网络错误会明确报告，不会降级为直接写 JSON 或 git 文件。Claude Code 与 DSH 读取同一份配置的插件注册表和设置。 |
| `/reload-cc-plugins` | 刷新**当前会话**的技能目录，等待刷新完成并报告失败。新增或移除的技能无需新建会话即可出现；MCP 与 hook 变更仍需重启 DSH。 |
| `/reload-skills` | `/reload-cc-plugins` 的别名。 |
| `/cc-export` | 列出或导出 DSH 原生 skill（`.dsh/skills`）到 Claude Code `.claude/skills/<name>/SKILL.md`，保留 frontmatter。使用会话的有效工作目录，桌面版通过真正的 Node 解释器执行。`list` / `export [--overwrite] [--target <目录>]`；相对目标路径按有效工作目录解析。 |
| `/cc-resume` | 浏览 Claude 历史并把背景交给 DSH 接续。对话内的卡片直接续接当前 DSH 会话；管理页的一键恢复在源项目工作区新建普通 DSH 会话。`list` / `resume <Claude sessionId> [--cwd 源目录] [--limit-turns N]`；`import` 是 `resume` 的别名，`archive` 才是旧式历史归档副本。 |

典型闭环：`/cc-plugin install ralph-loop@claude-plugins-official` → `/reload-cc-plugins` → 新技能立即可见。插件自带的 MCP 服务器仍需重启 DSH（进程级挂载）。

### 上下文接续与旧式归档

一键恢复只定位配置的 Claude `projects/` 源文件，并发送文件路径及简短的阅读总结指令。DSH 按需读取文件，先概述背景、当前任务状态和下一步计划；插件不内联正文、不扫描全文，也不自动执行历史待办。源文件查找位置和目标 DSH 会话身份分别传递，Claude 历史中途切换目录不会阻止接续。

原生界面与命令使用配置的 `userClaudeDir`。可用 `/cc-resume resume <id> --cwd <源项目>` 选择其他项目历史，同时在发起命令的 DSH 会话继续。显式 `archive` 和 `sessions.import` 仍保留为独立归档操作，并保留已有 DSH 日志。独立 CLI 是旧格式工具，不参与一键恢复。

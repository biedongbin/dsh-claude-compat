[← 项目首页](../../../README.zh-CN.md) · [English](../en/installation.md)

# 环境要求

- DSH 及其 profile（如 `web`）
- 使用 Claude Code 约定的项目：`.claude/skills/`、`.claude/commands/`、`.claude/rules/`、`.claude/agents/`、`.claude/settings.json` 与项目根 `.mcp.json`（均可选；`~/.claude/` 对应目录同样生效）
- `PATH` 上有 `pnpm` —— `dsh plugin` 是 pnpm 的薄转发层

## 安装 / 更新

一条命令 —— 包声明了 `dsh.bundle`，DSH 自动激活（无需手改 `cordis.patch.yml`）。安装或更新到最新版：

```bash
dsh plugin --profile web add dsh-claude-compat@latest
```

或从 GitHub：

```bash
dsh plugin --profile web add github:biedongbin/dsh-claude-compat
```

重启 DSH（`dsh web`）。完成 —— skills 出现在 `/` 菜单，rules 注入每个新会话。

**也可以让 DSH 安装：**

> 请阅读 https://github.com/biedongbin/dsh-claude-compat/blob/main/.claude/skills/install-dsh-compat/SKILL.md 并按步骤安装 dsh-claude-compat 插件。

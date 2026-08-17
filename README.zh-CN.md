<p align="center">
  <img src="https://img.shields.io/badge/dsh-插件-blue?style=for-the-badge" alt="DSH 插件">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/🌐_English-Click_me-red?style=for-the-badge" alt="English"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

<p align="center">DeepSeek Harness 插件：把 Claude Code 的 <code>.claude/</code> 目录原生桥接进 DSH —— skills、斜杠命令、rules 零迁移直接复用。</p>

## 功能

| `.claude/` 路径 | 机制 | 行为 |
|---|---|---|
| `skills/**/SKILL.md` | DSH skill provider | 仅 name + description 进模型可见目录；正文按需加载（`skill` 工具）。新增 skill 下次 catalog 刷新即出现，无需重启。 |
| `commands/*.md` | DSH skill provider | 同上，且用户可直接调用：斜杠菜单里 `/command-name` 可用。 |
| `rules/*.md` | 消息流注入 | rules 全文拼接，包 `<system-reminder>` 信封，每会话一次以 user-role 消息插在消息数组最前 —— 与 Claude Code 同通道（`prependUserContext`），模型可靠遵循。 |

同类三个目录同样读取**用户级** `~/.claude/`（skills、commands、rules）。同名 skill/command/rule 去重，优先级固定：

**项目 `.claude` > DSH 原生（`.dsh`）> `~/.claude`**

- 项目 `.claude` 条目 rank=`50`；DSH 自身 skills —— 项目 `.dsh` 根、`.agents` 根与 bundled skills（rank=`100`–`600`，`BUNDLED_SKILL_RANK`）—— 位于两者之间；`~/.claude` 条目 rank=`700`。项目 skill 永远压过 DSH 原生与用户副本；用户 skill 永远压不过 DSH 原生。
- `~/.claude/rules` 中与项目同 basename 的 rule 文件被跳过（项目优先）。

`CLAUDE.md` / `AGENTS.md` **不碰** —— DSH 内置 `dsh-agent-instructions` 已处理。

## 环境要求

- DSH 及其 profile（如 `web`）
- 使用 Claude Code 约定的项目：`.claude/skills/`、`.claude/commands/`、`.claude/rules/`（均可选；`~/.claude/` 对应目录同样生效）
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

## 配置

| 选项 | 默认值 | 说明 |
|---|---|---|
| `enableSkills` | `true` | 注册 `.claude/skills` + `.claude/commands` provider（项目与 `~/.claude` 均含） |
| `enableRules` | `true` | 注入项目 + `~/.claude` 的 `rules/*.md` 到消息流 |
| `rulesMaxBytes` | `65536` | 注入项目 rules 总量硬上限 |
| `userRulesMaxBytes` | `65536` | 注入 `~/.claude/rules` 总量硬上限 |
| `projectRootMarkers` | `[".git"]` | 项目根发现的祖先标记 |
| `skillRank` | `50` | 项目 `.claude` skills 的 provider 排名（压过一切 DSH 原生冲突） |
| `skillSource` | `project-claude` | 项目 catalog 条目来源标签 |
| `userSkillRank` | `700` | `~/.claude` skills 的 provider 排名（输给 DSH 原生 `600`） |
| `userSkillSource` | `user-claude` | `~/.claude` catalog 条目来源标签 |
| `userClaudeDir` | `~/.claude` | 用户级 `.claude` 目录（`~` 展开为 home 目录） |

## 说明

- **Skill 命名**：DSH 要求 kebab-case。嵌套 skill 目录扁平化（`gitnexus/gitnexus-guide` → `gitnexus-gitnexus-guide`）；frontmatter 名字非法时回退目录名。
- **Rules 粒度**：每个新会话读取（按会话 cwd 缓存）。会话中改 rule，下一会话生效。
- **Rules 内容**：rules 原文注入为模型指令。只提交你想让模型遵循的 rule —— 信任级别同 `CLAUDE.md`。

## 社区鸣谢

- [Linux.do](https://linux.do) —— 社区
- [Claude Code](https://claude.com/claude-code) —— 本插件桥接的 `.claude/` 约定
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) —— 本插件扩展的运行时

## License

[MIT](LICENSE)

## ⭐ Star History

如果这个项目对你有帮助，请给个 ⭐ —— 这是我们持续改进的动力。

<p align="center">
  <img src="https://img.shields.io/github/stars/biedongbin/dsh-claude-compat?style=for-the-badge&logo=github&color=gold" alt="GitHub Stars">
  <img src="https://img.shields.io/github/forks/biedongbin/dsh-claude-compat?style=for-the-badge&logo=github" alt="GitHub Forks">
  <img src="https://img.shields.io/github/watchers/biedongbin/dsh-claude-compat?style=for-the-badge&logo=github" alt="GitHub Watchers">
</p>

<div align="center">
  <a href="https://www.star-history.com/#biedongbin/dsh-claude-compat&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=biedongbin/dsh-claude-compat&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=biedongbin/dsh-claude-compat&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=biedongbin/dsh-claude-compat&type=Date" width="760" />
    </picture>
  </a>
</div>

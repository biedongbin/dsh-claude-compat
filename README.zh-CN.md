<p align="center">
  <img src="https://img.shields.io/badge/dsh-插件-blue?style=for-the-badge" alt="DSH 插件">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/🌐_English-Click_me-red?style=for-the-badge" alt="English"></a>
  <img src="https://img.shields.io/npm/dm/dsh-claude-compat?style=flat-square&label=downloads/month&color=brightgreen" alt="npm downloads/month">
  <img src="https://img.shields.io/npm/dt/dsh-claude-compat?style=flat-square&label=total%20downloads&color=blue" alt="npm total downloads">
  <img src="https://img.shields.io/npm/v/dsh-claude-compat?style=flat-square&label=version&color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

> **在 DSH 中复用 Claude Code 配置。**
> 桥接 skills、命令、规则、agents、hooks 与 MCP，并明确说明运行时限制和升级步骤。

---

## 10 秒速览

1. **把 Claude Code 配置带到 DSH。** 复用已有 `.claude/` 目录中受支持的技能、斜杠命令、规则、代理定义、hooks 和 MCP 配置。
2. **在 DSH 内管理 Claude 插件。** 从 **插件 → Claude Code** 浏览已安装插件和市场，也可以用 `/cc-plugin` 在对话中打开管理界面。
3. **接着理解 Claude 会话中的任务。** 用 `/cc-resume` 查找、预览历史会话，再交给 DSH 阅读并总结背景、任务状态和下一步。

技能可在当前会话刷新；MCP 与 hook 配置变更需要重启 DSH。受支持的运行时及能力边界见[兼容与升级说明](docs/readme/zh-cn/compatibility.md)。

![DSH 内的 Claude Code 插件管理](docs/demo-video/screenshots/zh-CN/plugin-navigation.png)

## 演示视频 · 61 秒 · 完整版

[观看／下载中文 MP4](docs/videos/dsh-claude-compat-2_0-complete-zh-CN.mp4) · [English video](docs/videos/dsh-claude-compat-2_0-complete-en.mp4)

在 2.0.0 真实界面上连续演示完整流程：界面安装入口、`/cc-plugin` 管理与筛选、桥接技能的实际模型回复、`/cc-resume` 预览并接续历史（真实总结）、Claude 桥接总览、能力下钻与即时搜索、源文件查看。1 倍速、无声；模型等待已剪去，回复完整保留。录制使用明确标注的演示历史与临时演示技能，个人信息已遮盖。[录制源与剪辑说明](docs/demo-video/complete-v2-production.md)。

## 快速开始

**桌面端 / Web 界面安装**

打开 **插件 → 添加插件**，输入 `dsh-claude-compat`，点击 **安装**。下图在 Web 端重新截取，展示界面安装入口。

![通过 DSH 添加插件界面填写 dsh-claude-compat](docs/readme/assets/install-plugin-zh-cn.png)

**命令行安装**

需要 **DSH 0.2.1-rc.2 或 0.2.2-rc.1**，且 `PATH` 中可用 `pnpm`；推荐 **Node.js 24**。

```bash
dsh plugin --profile web add dsh-claude-compat@latest
dsh web
```

如果 DSH 已运行，请重启。插件会自动读取项目与用户级 `.claude/` 配置；仅启用可信项目中的 hooks。

| 命令 | 用途 |
|---|---|
| `/cc-plugin` | 管理 Claude 插件与市场 |
| `/cc-resume` | 浏览 Claude 历史并接续上下文 |
| `/reload-skills` | 刷新当前会话的技能目录 |
| `/cc-export` | 将 DSH 技能导出到 Claude Code |

[更多安装方式](docs/readme/zh-cn/installation.md) · [完整命令用法](docs/readme/zh-cn/commands.md)

## 使用文档

| 文档 | 内容 |
|---|---|
| [安装与更新](docs/readme/zh-cn/installation.md) | 环境要求、升级命令与辅助安装 |
| [命令与历史接续](docs/readme/zh-cn/commands.md) | 插件管理、技能导出、上下文接续和旧式归档 |
| [参数配置](docs/readme/zh-cn/configuration.md) | 全部参数、默认值和环境变量 |
| [桥接机制](docs/readme/zh-cn/bridge-behavior.md) | 支持内容、优先级、生效时机和中文技能名 |
| [Hooks](docs/readme/zh-cn/hooks.md) | 事件、处理器和运行时限制 |
| [MCP 服务器](docs/readme/zh-cn/mcp.md) | 来源、传输、策略、凭据与兼容边界 |
| [兼容与升级](docs/readme/zh-cn/compatibility.md) | 已验证的 DSH 版本与迁移说明 |
| [故障排查](docs/readme/zh-cn/troubleshooting.md) | 技能缺失、CLI 错误、启动和归档问题 |

## 2.0.0 更新亮点

**总览页将发现条目、阅读文件与翻译集中到一处。** 浏览技能、命令、Agents、规则、Hooks、MCP 声明及插件，按插件查看能力，并检查同名候选；Claude 侧已禁用的插件仍然可见。计数表示发现的清单，不是运行时挂载快照。MCP 清单只读解析，不执行 `headersHelper`；插件 Hooks 与规则仅展示声明，本桥接不会注入它们。

- **DSH 开关：** 按项目从桥接技能目录中过滤技能、命令和 Agents；插件开关只批量控制这三类。状态保存在 `.dsh/claude-compat-state.json`，与 Claude Code 侧启用状态分开。规则、Hooks 与 MCP 条目仅供查看，关闭插件不会卸载其 MCP 或 Hooks。
- **阅读与管理文件：** 在查看器打开有文件的条目、复制路径，并将受支持的项目文件移入项目回收站；恢复时不会覆盖已有文件。
- **仅供查看的翻译：** 将正文译为当前 DSH 界面语言，原文与译文并排显示。原文件不变；围栏代码块原样保留，不发送给翻译提供方。结果按原文内容与目标语言缓存到磁盘；命中缓存不发起提供方调用，**重新翻译**会请求新译文。优先使用 DSH 翻译服务；未挂载该服务时，使用配置的默认模型逐段翻译，消耗模型 token，并可能产生费用。大文件可能需要多次调用。关闭并重新打开查看器可恢复进度；失败、取消或截断的输出不会作为成功译文保存。

能力与升级边界见[桥接机制](docs/readme/zh-cn/bridge-behavior.md)、[命令说明](docs/readme/zh-cn/commands.md)及 [2.0.0 更新日志](CHANGELOG.zh-CN.md#200--2026-11-17)。上方演示视频已包含总览页内容。

## 更新日志

[版本历史](CHANGELOG.zh-CN.md) · [English](CHANGELOG.md)

<details>
<summary>社区与项目统计</summary>

## 社区鸣谢

- [Linux.do](https://linux.do) —— 社区
- [Claude Code](https://claude.com/claude-code) —— 本插件桥接的 `.claude/` 约定
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) —— 本插件扩展的运行时

## 📈 NPM 下载趋势

![NPM Downloads](.github/assets/downloads.svg)

[Data: api.npmjs.org](https://www.npmjs.com/package/dsh-claude-compat) · [npmtrends](https://npmtrends.com/dsh-claude-compat/)

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

</details>

## License

[MIT](LICENSE)

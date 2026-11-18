<p align="center">
  <img src="https://img.shields.io/badge/dsh-plugin-blue?style=for-the-badge" alt="DSH Plugin">
</p>

<h1 align="center">dsh-claude-compat</h1>

<p align="center">
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/🌐_简体中文-点我阅读中文-red?style=for-the-badge" alt="简体中文"></a>
  <img src="https://img.shields.io/npm/dm/dsh-claude-compat?style=flat-square&label=downloads/month&color=brightgreen" alt="npm downloads/month">
  <img src="https://img.shields.io/npm/dt/dsh-claude-compat?style=flat-square&label=total%20downloads&color=blue" alt="npm total downloads">
  <img src="https://img.shields.io/npm/v/dsh-claude-compat?style=flat-square&label=version&color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="License">
</p>

> **Reuse your Claude Code configuration in DSH.**
> Bridge skills, commands, rules, agents, hooks and MCP, with documented runtime limits and upgrade guidance.

---

## The 10-second pitch

1. **Bring your Claude Code setup to DSH.** Reuse supported skills, slash commands, rules, agent definitions, hooks and MCP configuration from your existing `.claude/` directories.
2. **Manage Claude plugins inside DSH.** Browse installed plugins and marketplaces from **Plugins → Claude Code**, or open the manager in a conversation with `/cc-plugin`.
3. **Pick up context from Claude conversations.** Use `/cc-resume` to find and preview a past session, then ask DSH to read it and summarize the background, task state and next steps.

Skills can reload in the current session. MCP and hook configuration changes require a DSH restart; the [compatibility and upgrade notes](docs/readme/en/compatibility.md) describe the supported runtime boundaries.

![Claude Code plugin management inside DSH](docs/demo-video/screenshots/en/plugin-navigation.png)

## Demo video · 64 seconds · complete

[Watch / download the English MP4](docs/videos/dsh-claude-compat-2_0-complete-en.mp4) · [中文版视频](docs/videos/dsh-claude-compat-2_0-complete-zh-CN.mp4)

A continuous walkthrough of 2.0.0: the graphical install entry, `/cc-plugin` management and filtering, a real model reply from a bridged skill, `/cc-resume` previewing and resuming history (with an actual summary), the Claude bridge inventory, capability drill-down with live search, and source-file viewing. 1× speed, silent; model waits are cut while replies stay complete. The recording uses labelled demo history and a demo-only skill; private details are masked. [Recording source and editing notes](docs/demo-video/complete-v2-production.md).

## Quick start

**Install from the desktop / Web interface**

Open **Plugins → Add plugin**, enter `dsh-claude-compat`, then click **Install**. The fresh Web capture below shows the graphical installation entry.

![Enter dsh-claude-compat in the DSH Add plugin dialog](docs/readme/assets/install-plugin-en.png)

**Install from the command line**

Requires **DSH 0.2.1-rc.2 or 0.2.2-rc.1**, with `pnpm` on `PATH`. **Node.js 24** is recommended.

```bash
dsh plugin --profile web add dsh-claude-compat@latest
dsh web
```

Restart DSH if it is already running. Your existing project and user-level `.claude/` configuration is read automatically. Only enable hooks from projects you trust.

| Command | Use |
|---|---|
| `/cc-plugin` | Manage Claude plugins and marketplaces |
| `/cc-resume` | Browse Claude history and continue with its context |
| `/reload-skills` | Refresh the current session's skill catalog |
| `/cc-export` | Export DSH skills to Claude Code |

[More installation options](docs/readme/en/installation.md) · [All command options](docs/readme/en/commands.md)

## Documentation

| Guide | Contents |
|---|---|
| [Installation](docs/readme/en/installation.md) | Requirements, update commands and assisted installation |
| [Commands and history](docs/readme/en/commands.md) | Plugin management, skill export, context handoff and legacy archives |
| [Configuration](docs/readme/en/configuration.md) | All parameters, defaults and environment variables |
| [Bridge behavior](docs/readme/en/bridge-behavior.md) | Supported assets, precedence, lifecycle and non-ASCII skill names |
| [Hooks](docs/readme/en/hooks.md) | Events, handlers and runtime limitations |
| [MCP servers](docs/readme/en/mcp.md) | Sources, transports, policy, credentials and compatibility gaps |
| [Compatibility and upgrades](docs/readme/en/compatibility.md) | Tested DSH versions and migration notes |
| [Troubleshooting](docs/readme/en/troubleshooting.md) | Missing skills, CLI errors, startup and archive issues |

## What's new in 2.0.0

**The inventory brings discovery, file reading and translation into one page.** Browse skills, commands, agents, rules, hooks, MCP declarations and plugins; drill into a plugin's capabilities and inspect duplicate candidates. Disabled Claude plugins remain visible. Counts describe the discovered inventory, not a snapshot of mounted runtime integrations. MCP inspection is read-only and does not execute `headersHelper`; plugin hooks and rules are declarations that this bridge does not inject.

- **DSH switches:** per-project switches filter skills, commands and agents from the bridge's skill catalog. A plugin switch groups those three kinds only. State is saved in `.dsh/claude-compat-state.json`; Claude Code's enablement stays separate. Rules, hooks and MCP rows are view-only, and switching a plugin does not unmount its MCP servers or hooks.
- **Read and manage files:** open file-backed entries in the viewer, copy paths, and move supported project files to the project trash with restore protection against overwriting existing files.
- **View-only translation:** translate prose into the current DSH interface locale, with original and translation side by side. Source files stay unchanged; fenced code is preserved and excluded from provider requests. Results use a disk cache keyed by source content and target language; cache hits make no provider calls. **Translate again** requests fresh translation. DSH's translator service is preferred; when absent, the configured default model handles prose chunks, consuming model tokens and potentially incurring charges. Large files can require multiple calls. Progress survives closing and reopening the viewer; failed, cancelled or truncated output is not saved as a successful translation.

See [bridge behavior](docs/readme/en/bridge-behavior.md), [commands](docs/readme/en/commands.md) and the [2.0.0 release notes](CHANGELOG.md#200--2026-11-17) for details and upgrade boundaries. The demo above predates this inventory update.

## Changelog

[Release history](CHANGELOG.md) · [简体中文](CHANGELOG.zh-CN.md)

<details>
<summary>Community and project stats</summary>

## Acknowledgments

- [Linux.do](https://linux.do) — community
- [Claude Code](https://claude.com/claude-code) — the `.claude/` conventions this plugin bridges
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) — the runtime this plugin extends

## 📈 NPM Downloads

![NPM Downloads](.github/assets/downloads.svg)

[Data: api.npmjs.org](https://www.npmjs.com/package/dsh-claude-compat) · [npmtrends](https://npmtrends.com/dsh-claude-compat/)

## ⭐ Star History

If this project helps you, please give it a ⭐ — it motivates us to keep improving.

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

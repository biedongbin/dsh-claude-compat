---
title: dsh-claude-compat
subtitle: 在 DSH 中复用 Claude Code 配置 · v1.2.1 · 功能示意
lang: zh
theme: 3b1b
mode: dark
---

## 一套配置，继续使用
```flow LR
Claude配置 -> 兼容桥: 读取
兼容桥 -> DSH: 暴露支持的内容
```
> 把已有的 Claude Code 配置带到 DSH。
> 复用技能、命令、规则与代理定义。

## 从命令开始
- /cc-plugin：管理插件与市场
- /reload-skills：刷新当前会话技能
> 用 cc-plugin 管理插件与市场。
> 新增技能后，刷新当前会话目录。

## 让历史成为下一步的背景
```flow LR
选择历史 -> 发送文件引用: cc-resume
发送文件引用 -> DSH按需阅读: 总结背景与下一步
```
> 用 cc-resume 选择 Claude 历史会话。
> 交给 DSH 按需阅读，再总结任务状态。

## 带着明确的边界迁移
- 技能目录支持当前会话刷新
- MCP 与 hooks 配置变化需要重启 DSH
- agents 通过委派 shim skill 暴露
> 技能可刷新，MCP 与 hooks 变化需重启。
> 代理定义通过委派技能接入。

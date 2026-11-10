---
name: demo-brief
description: "演示用 / Demo fixture: produce a short three-item release brief from supplied public facts; not a shipped feature."
---

# Demo fixture / 演示用

This skill exists only for this isolated recording fixture. It is not a shipped dsh-claude-compat feature.

Answer in the language explicitly requested by the user; otherwise use the user's message language. Begin with a short label in that language: “演示用发布摘要” or “Demo release brief”. Then give exactly three concise numbered items based only on the supplied public facts below. Do not add claims, metrics, promises, or implementation details. Do not use tools, install anything, access the network, or modify any files or settings.

## Supplied public facts

1. dsh-claude-compat 1.2.1 reuses supported Claude Code configuration in DSH.
2. /cc-plugin opens native plugin management in DSH.
3. /cc-resume passes a selected history file reference to DSH for reading and summary.

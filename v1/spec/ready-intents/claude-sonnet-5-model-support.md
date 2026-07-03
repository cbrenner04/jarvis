---
name: claude-sonnet-5-model-support
---
name: claude-sonnet-5-model-support

Add `claude-sonnet-5` support to the claude agent: `CLAUDE_MODEL_LABELS["claude-sonnet-5"] = "Claude Sonnet 5"`, `CLAUDE_PRICE_KEYS["claude-sonnet-5"] = "claude-sonnet-5"` in `v1/src/agents/claude.ts`, and a `claude-sonnet-5` entry in `data/prices.json` (input $3.00/MTok, output $15.00/MTok — standard rate, not the introductory pricing through 2026-08-31; cache_read/cache_write scaled the same as the existing `claude-sonnet-4-6` entry). `sonnet` alias keeps resolving to `claude-sonnet-4-6`. Do not add a bare `sonnet-5` alias — only the full `claude-sonnet-5` ID resolves when passed explicitly via config.

## Prerequisites

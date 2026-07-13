---
name: v2-help-overview
---

# `jarvis help` prints a v2 overview

`jarvis help` currently falls through v2's dispatch chain and prints `v2 not ready`, exit 0 —
it reads as a broken binary. Make it print an overview: one line on what jarvis is, then v2's
real commands (`write`, `daemon`, `config`, `run`, `tui`) by name with a one-line summary each,
grouped by operator lifecycle. Short enough for one screen. No flag signatures inline. Exit 0.

Scope to v2's actual command set — not v1's vocabulary (`cleanup`, `triage`, `prices`, …), which
is what made the four deleted `ready-intents/` help intents unusable.

This slice introduces the command registry the rest of the help surface reads from: command name,
summary, and usage text in one place, replacing the ad-hoc `*_USAGE` constants in `v2/src/cli.ts`.

Help is a v2 addition, not a v1 behavior change — no `v2/docs/v1-behaviors.md` update.

## Prerequisites

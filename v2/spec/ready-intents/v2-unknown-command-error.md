---
name: v2-unknown-command-error
---

# An unknown command errors instead of printing `v2 not ready`

Any argv v2 doesn't match falls through to `out.stdout("v2 not ready\n")` and exit 0 — a typo
reports success. Replace the fallthrough: print the unknown command on stderr, add a "did you
mean <x>?" when exactly one registered command is a close match, point at `jarvis help`, exit
non-zero.

## Prerequisites

- `jarvis help` prints an overview from a registry of v2's commands, summaries, and usage text

---
name: v2-install-and-config
description: Fresh-machine guide to install the v2 jarvis binary and configure agents/models and the daemon
---

# Onboarding: install and configure v2

A procedural guide taking a reader from a fresh checkout to a configured, running
v2 install. Ends with the reader able to start the daemon and confirm it is up.

Covers:

- Prerequisites (Bun, `gh` authenticated, at least one agent CLI on PATH) and cloning/symlinking `jarvis` alongside the existing `jarvis1` shim.
- Bootstrapping and editing the v2 machine config: the per-machine agent fallback order and the machine-independent role→model store, via `jarvis config` (show/path/set-agents).
- Starting and checking the daemon (`jarvis daemon start|status|stop`).
- Where config lives on disk and how to recover from a missing/invalid config (the load-time errors a new user will actually hit).

Only document behavior that ships; do not invent config knobs.

## Prerequisites

- The v2 machine config (agent fallback order + role→model store) loads and validates from disk.
- `jarvis config` show/path/set-agents behavior exists.
- `jarvis daemon` start/stop/status behavior exists.

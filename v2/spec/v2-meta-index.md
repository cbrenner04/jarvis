# Jarvis v2 — Meta index

Top-level progress checklist for v2, built from [`v2-build-order.md`](../docs/v2-build-order.md). One item per phase; each phase becomes its own dated spec under `v2/spec/` when implementation begins. Check a phase when its spec is complete and merged.

- [x] Phase 0 — v2 project scaffold: tsconfig project, CLI entry, bin shim, cross-tree import boundaries
- [ ] Phase 1 — First write step, end-to-end: one `write` step run once from the CLI (render → invoke → outcome → output contract → worktree), host-agnostic core behind a thin CLI host, quota fallback
- [ ] Phase 2 — The write loop (behavior #1): loop until artifact/criteria/blocker, max counts, early-stop; durable state earns its first rows for resume; kill-resume over a dirty worktree
- [ ] Phase 3 — Daemon host + IPC + structured logging: long-running second host over the same core, programmatic API (start/list/tail/pause/resume/kill), CLI control surface
- [ ] Phase 4 — TUI seed: first interactive client over the daemon API; start dogfooding
- [ ] Phase 5 — Workflow runner + project config binding: linear-with-bounded-loops steps, per-step agent bindings, workflow presets; durable state grows step IDs + attempt history
- [ ] Phase 6 — Remaining behaviors: review-and-update loop, human loop (pause/resume/kill) via the steering API
- [ ] Phase 7 — Concurrency + admission: memory-watermark admission, `queued` status, concurrent runs, local model last in order
- [ ] Phase 8 — PR lifecycle + attribution: worktree → branch → draft PR → ready, per-commit `Jarvis-Agent` footer

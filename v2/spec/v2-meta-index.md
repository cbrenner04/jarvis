# Jarvis v2 — Meta index

Top-level progress checklist for v2, built from [`v2-build-order.md`](../docs/v2-build-order.md). One item per phase; each phase becomes its own dated spec under `v2/spec/` when implementation begins. Check a phase when its spec is complete and merged.

- [x] Phase 0 — v2 project scaffold: tsconfig project, CLI entry, bin shim, cross-tree import boundaries
- [ ] Phase 1 — State store (SQLite): runs/steps/outcomes schema, orchestration-vs-work split, kill-resume == crash-recovery
- [ ] Phase 2 — Daemon shell + IPC + structured logging: long-running host, programmatic API (ping/list-runs/shutdown), CLI control surface
- [ ] Phase 3 — Single step execution: one `write` step run once in the daemon, output contract, worktree, quota fallback
- [ ] Phase 4 — TUI seed: minimal interactive client over the daemon API; start dogfooding
- [ ] Phase 5 — The write loop (behavior #1): loop until artifact/criteria/blocker, max counts, early-stop, kill-resume over dirty worktree
- [ ] Phase 6 — Workflow runner + project config binding: linear-with-bounded-loops steps, per-step agent bindings, workflow presets
- [ ] Phase 7 — Remaining behaviors: review-and-update loop, human loop (pause/resume/kill) via the steering API
- [ ] Phase 8 — Concurrency + admission: memory-watermark admission, `queued` status, concurrent runs, local model last in order
- [ ] Phase 9 — PR lifecycle + attribution: worktree → branch → draft PR → ready, per-commit `Jarvis-Agent` footer

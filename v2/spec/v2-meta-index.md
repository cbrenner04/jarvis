# Jarvis v2 — Meta index

Top-level progress checklist for v2, built from [`v2-build-order.md`](../docs/v2-build-order.md). One item per phase. A phase delivers merged implementation code in `v2/src`, not a merged dated spec.

Phase-start workflow:

1. Read the phase line below and the matching section in [`v2/docs/v2-build-order.md`](../docs/v2-build-order.md).
2. Write a short build brief describing the code to ship for that phase.
3. Run `jarvis1 plan "<build brief>"` to draft execution intent artifacts.
4. Run `jarvis1 run ...` to implement and merge the code.

`v2/spec/seeds/*.md` and dated intent/spec trees are generated execution evidence. They are not the durable done condition for a phase.

- [x] Phase 0 — v2 project scaffold: tsconfig project, CLI entry, bin shim, cross-tree import boundaries
- [x] Phase 1 — First write step, end-to-end: one `write` step run once from the CLI (render → invoke → outcome → output contract → worktree), host-agnostic core behind a thin CLI host, quota fallback
- [x] Phase 2 — The write loop (behavior #1): loop until artifact/criteria/blocker, max counts, early-stop; durable state earns its first rows for resume; kill-resume over a dirty worktree
- [ ] Phase 3 — Daemon host + IPC + structured logging: long-running second host over the same core, programmatic API (start/list/tail/pause/resume/kill), CLI control surface
- [ ] Phase 4 — TUI seed: first interactive client over the daemon API; start dogfooding
- [ ] Phase 5 — Workflow runner + project config binding: linear-with-bounded-loops steps, per-machine agent fallback order + machine-independent category→agent→model store (steps name a category), workflow presets; durable state grows step IDs + attempt history
- [ ] Phase 6 — Remaining behaviors: review-and-update as a debate (read-only adversary→defender→judge→verdict, separate executor), human loop (pause/resume/kill) via the steering API
- [ ] Phase 7 — Concurrency + admission: memory-watermark admission, `queued` status, concurrent runs, local model last in order
- [ ] Phase 8 — PR lifecycle + attribution: worktree → branch → draft PR → ready, per-commit `Jarvis-Agent` footer

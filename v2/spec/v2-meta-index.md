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
- [x] Phase 3 — Daemon host + IPC + structured logging: long-running second host over the same core, programmatic API (start/list/tail/pause/resume/kill), CLI control surface
- [x] Phase 4 — TUI seed: first interactive client over the daemon API; start dogfooding
- [x] Phase 5 — Workflow runner + project config binding: linear-with-bounded-loops steps, per-machine agent fallback order + machine-independent role→model store (steps name role; `(agent, role) → rungs`; missing required `(agent, role)` = hard error at load); planning and implementation depend on `role-resolution.md` + `agent-model-config.md` committed on `main`; must not use retired category taxonomy; workflow presets; durable state grows step IDs + attempt history
- [x] Phase 6 — Remaining behaviors: review-debate (read-only adversary→advocate→adjudicator→verdict, separate actuator), human loop (pause/resume/kill) via the steering API
- [x] Phase 7 — Concurrency + admission: memory-watermark admission, `queued` status, concurrent runs, TUI queue view. (Local-model-as-terminal-fallback dropped as stale; not part of this phase's delivered scope.)
- [x] Phase 8 — PR lifecycle + attribution: worktree → branch → draft PR → ready, per-commit `Jarvis-Agent` footer
- [ ] Phase 9 — Natural-language prompt router: prompt-first `jarvis "<intent>"` entry that classifies free text and routes to a workflow (new run) or an existing run (resume); conservative — asks for a sharper prompt when unsure

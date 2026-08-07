# Jarvis v2 — Meta index

Top-level progress checklist for v2. One item per phase. A phase delivers merged implementation code in `v2/src`, not a merged dated spec. `v2/spec/seeds/*.md` and dated intent/spec trees are generated execution evidence, not the durable done condition.

Open-phase workflow: write a short build brief for the phase, `jarvis run workflow plan` it, then `jarvis run workflow implement` the merged spec.

- [x] Phases 0–8 — shipped: project scaffold; end-to-end write step; write loop with durable resume; daemon host + IPC + structured logging; TUI; workflow runner + role→model config + presets; review behaviors; concurrency + memory-watermark admission (`queued`); PR lifecycle + `Jarvis-Agent` attribution
- [x] Per-project pipelines — shipped and dogfooded 2026-07-31, including intent-split fan-out. Contract and operator flow: [daemon-host.md](../docs/daemon-host.md) § Pipeline, [first-workflow-walkthrough.md](../docs/first-workflow-walkthrough.md) § Configured pipeline.
- [x] TUI — shipped 2026-08-07 (slices 1–6). Jarvis command center: pipeline tree with nested runs, fixed-width columns, wall-clock elapsed, command line for start/steer/approve/reject/resume, typed run steering (`kill`/`pause`/`resume-run`), and in-TUI `log` follow. Operator reference: [operator-runbook.md](../docs/operator-runbook.md) § Observe.
- [ ] Do we need much optimization or is slowness mostly Jarvis-on-Jarvis? Policy: measure end-to-end workflows on non-Jarvis repos by queue / agent / review / gate / publication time; optimize only the dominant component. `JARVIS_TEST_CONCURRENCY` is the working gate-contention lever (honored, not stomped like `JARVIS_READY_TIER`); changing it requires a daemon restart between runs.
- [ ] Natural-language prompt router: prompt-first `jarvis "<intent>"` entry that classifies free text and routes to a workflow (new run) or an existing run (resume); conservative — asks for a sharper prompt when unsure. Design after pipelines exist as the destination contract.

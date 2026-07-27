# Jarvis v2 — Meta index

Top-level progress checklist for v2. One item per phase. A phase delivers merged implementation code in `v2/src`, not a merged dated spec. `v2/spec/seeds/*.md` and dated intent/spec trees are generated execution evidence, not the durable done condition.

Open-phase workflow: write a short build brief for the phase, `jarvis run workflow plan` it, then `jarvis run workflow implement` the merged spec. Current implement ordering: [implement-queue.md](implement-queue.md).

- [x] Phases 0–8 — shipped: project scaffold; end-to-end write step; write loop with durable resume; daemon host + IPC + structured logging; TUI; workflow runner + role→model config + presets; review behaviors; concurrency + memory-watermark admission (`queued`); PR lifecycle + `Jarvis-Agent` attribution
- [ ] Per-project pipelines — [build brief](per-project-pipelines-brief.md). Compose named pipelines per project (`intent → human review → plan → …`); daemon-owned execution; durable stages with approve/reject and resume-at-stage.
- [ ] Major TUI overhaul — [build brief](tui-overhaul-brief.md). Pipeline-first UI, honest rows and timings, daemon inventory, list agent/model columns; monitor seed may precede the phase.
- [ ] Do we need much optimization or is slowness mostly Jarvis-on-Jarvis? Policy: measure end-to-end workflows on non-Jarvis repos by queue / agent / review / gate / publication time; optimize only the dominant component. `JARVIS_TEST_CONCURRENCY` is the working gate-contention lever (honored, not stomped like `JARVIS_READY_TIER`); changing it requires a daemon restart between runs.
- [ ] Natural-language prompt router: prompt-first `jarvis "<intent>"` entry that classifies free text and routes to a workflow (new run) or an existing run (resume); conservative — asks for a sharper prompt when unsure. Design after pipelines exist as the destination contract.

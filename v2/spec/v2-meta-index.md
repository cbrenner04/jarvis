# Jarvis v2 — Meta index

Top-level progress checklist for v2. One item per phase. A phase delivers merged implementation code in `v2/src`, not a merged dated spec. `v2/spec/seeds/*.md` and dated intent/spec trees are generated execution evidence, not the durable done condition.

Open-phase workflow: write a short build brief for the phase, `jarvis run workflow plan` it, then `jarvis run workflow implement` the merged spec.

- [x] Phases 0–8 — shipped: project scaffold; end-to-end write step; write loop with durable resume; daemon host + IPC + structured logging; TUI; workflow runner + role→model config + presets; review behaviors; concurrency + memory-watermark admission (`queued`); PR lifecycle + `Jarvis-Agent` attribution
- [ ] Per-project pipelines: compose pipelines of workflows on a per-project basis. I want to be able to say for X project, the pipeline is `intent (light) -> human review -> plan (debate) -> human review -> implement (debate) -> human review`. Or for project Y, the pipeline is `intent (none) -> plan (none) -> implement (light) -> merge to main`. Potential Pre-requisites:
  - `jarvis init`
- [ ] Natural-language prompt router: prompt-first `jarvis "<intent>"` entry that classifies free text and routes to a workflow (new run) or an existing run (resume); conservative — asks for a sharper prompt when unsure

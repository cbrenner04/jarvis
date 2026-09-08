# v1 (frozen)

This tree is the retired first Jarvis engine (`jarvis1`), kept for reference only. It is **frozen**: not compiled, tested, linted, linked, or shipped. `bin/jarvis1` is gone, its test slices and CI steps are gone, and Biome, markdownlint, and `tsc` all exclude `v1/**`.

- Treat it as read-only history. Do not edit it, route work to it, cite it as a live source, or author specs under `v1/spec/`.
- It imports `shared/` modules as they were at the freeze; shared has moved on, so the tree does not build against current `main`. To run it, check out tag `v1-final`.
- The live docs that used to live here moved to `v2/docs/`: `operator-practices.md` (from `operator-runbook.md`), `spec-guidance.md`, `quota-signals.md`, `prompt-governance.md`. `v2/docs/v1-behaviors.md` records the parity decisions made while v2 replaced it.

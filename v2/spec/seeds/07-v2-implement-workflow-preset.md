---
name: v2-implement-workflow-preset
---

# Implement workflow preset and operator launch surface

Ship the first real workflow preset (`implement`): one `write` step with `role: implement`, appropriate prompt id, and output contract — not `write-write`. Expose it through daemon/CLI so operators don't hand-assemble `WriteLoopInput` flags every run.

## Decisions

- **`write-write` is test-only** — remove from any operator docs/examples; keep `resolveWorkflowPreset("write-write", …)` for composability tests only.
- **`implement` preset** lives in `v2/src/workflows/implement.ts` (or equivalent): single write step, `role: implement`, `promptId` for patch/implement body (exact id pinned in subspec), standard artifact/spec contract semantics from `write-behavior.md`.
- **Launch surface:** add operator entry — e.g. `jarvis run workflow implement` or `jarvis workflow run implement` — that:
  - Resolves project from cwd + `~/.jarvis/config.json` registry (same rules as v1 project resolution where applicable).
  - Accepts required run args: spec path (positional or `--spec`), branch/base per existing conventions or sensible defaults documented in subspec.
  - Builds workflow via preset + `loadWorkflowSteps`, calls daemon `start` with workflow execution input (extend daemon `start` if it only accepts bare `WriteLoopInput` today).
- **Thinner than `jarvis write`:** preset supplies topology + prompt id + default `stepRules`/contract patterns; operator does not pass `--agents` (machine config). Document which flags remain per-run vs preset-owned.
- **Shrink:** if `v2-shrink-role` landed, implement completion triggers shrink automatically — preset does not list shrink.
- **Docs:** `workflow-runner.md`, `write-behavior.md`, short operator section (how to start an implement run).

## Out of scope

- Full `plan` or `yolo` presets.
- PR lifecycle (Phase 8).
- TUI workflow launcher (can follow).
- Per-project workflow enablement.

## Prerequisites

- Workflow runner + `loadWorkflowSteps` for write steps.
- Per-step `promptId` seam (or land this spec immediately after `v2-per-step-prompt-ids`).
- Daemon `start` / IPC (may need workflow-shaped params).
- Machine profile config for agent/model resolution (or interim global file).

## Ordering

07 — after 05 (promptId seam) and 06 (machine profiles); before natural-language router (Phase 9). Parallel with 09 optional. Note: the daemon `start` extension lands on the in-process test harness from seed 03 (no new socket-gated tests) and needs no client-side field validators per seed 04.

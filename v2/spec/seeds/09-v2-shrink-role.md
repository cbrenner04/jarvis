---
name: v2-shrink-role
---

# Shrink role bolted onto implement complete

Add `shrink` to the closed `Role` union as a distinct model-resolution key (beefier rungs than `implement`). Run shrink automatically after an `implement` write step reaches `complete` — same completion-boundary hook v1 patch uses — without adding a shrink step to workflow presets.

## Decisions

- **`shrink` role** joins `plan`, `implement`, `adversary`, `advocate`, `adjudicator`, `actuator`, `operator` in `role-resolution.md`. `implement` keeps smaller/cheaper rungs for scoped subspec work; `shrink` and `actuator` expect beefier rungs in machine profile `models`.
- **Not a workflow step:** presets list only the `implement` write step. The workflow runner (or write-loop completion hook it calls) invokes one shrink pass after implement `complete`, before advancing to the next preset step or finishing.
- **Shrink pass:** one bounded write-loop-style invocation using `role: shrink`, shrink prompt id (existing v1 shrink prompt artifact or v2 equivalent), same worktree/spec context as the implement step just completed. Reuse `executeWrite` / step-runner path; do not fork a parallel shrink implementation.
- **Trigger:** shrink runs on implement `complete` only — not on `budget-soft-stopped`, `blocked`, or `invocation_failure`. Match v1 completion-pipeline semantics unless docs already say otherwise.
- **Durable state:** shrink attempts are attributable (telemetry `role: shrink`, distinct binding chain). Whether shrink gets its own `stepId` or rides under implement's run is an implementation choice; daemon/TUI need not show a separate workflow step row in this slice.
- **Machine profiles:** `config/machines/*.json` must define `shrink` rungs for each agent that defines `implement` (load-time validation — same hard-error family as other roles).
- **Docs:** `role-resolution.md`, `agent-model-config.md`, `workflow-runner.md`, `write-behavior.md`.

## Out of scope

- Shrink as an explicit preset step or human gate.
- Mid-implement shrink (v1 shrink is post-complete only).
- v1 tier parity for separate patchActuator vs reviewActuator beyond `implement` + `shrink` split.

## Prerequisites

- Workflow runner dispatches `write` steps with role→model resolution.
- Write loop reaches terminal `complete` with contract check.
- Machine profile model load (or `data/agent-model-config.json` until profile seed lands — note ordering vs `v2-config-machine-profile`).

## Ordering

09 — after or with 06 (shrink rungs live in `config/machines/`; load-time validation covers the new role with 06's coarse messages). Parallel with 07 optional.

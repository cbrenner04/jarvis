---
name: workflow-print-run-id-at-admission
---

# Workflow launch prints the run ID at daemon admission

## Problem

`workflow.ts` already prints the workflow entry run ID on stdout immediately after a successful daemon `start`, before `waitForRunCompletion`. Operators and docs still treat early ID as the contract; regressions could reorder stdout, drop the line on some presets, or buffer it until wait completes. This intent hardens and tests admission-time ordering — not first-time emission.

## Decisions

- Pin stdout order: workflow entry run ID line immediately after successful `start`, before any client-side completion wait and before terminal completion JSON; rules out moving ID to post-wait or preset-specific omission.
- **First stdout line** is the run ID line on success; stderr (e.g. `intent paths:` on intent presets) may precede it; rules out treating stderr as the admission contract.
- Apply on every registered `jarvis run workflow` preset; rules out implement-only or attach-only emission.
- Preserve failed pre-admission validation and daemon `start` failures (non-zero exit, named stderr, no run ID line); rules out folding admission errors into attach semantics.
- Flush so the ID line is observable before a long wait when buffering would matter; rules out silent buffering through the first wait.
- CLI-only; rules out daemon run lifecycle or IPC shape changes for this slice.

## Acceptance criteria

- [ ] `workflow.test.ts` `run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON` stays green (baseline admission ID on stdout before wait JSON).
- [ ] A new regression in `workflow.test.ts` drives each registered workflow preset through admitted `start` and asserts the workflow entry run ID is the first **stdout** line before wait/completion JSON (stderr such as `intent paths:` excluded); inverting flush, preset omission, or post-wait reorder fails the test.
- [ ] `workflow.test.ts` asserts the admission stdout run ID equals the `wait` IPC `runId` for an in-flight admitted workflow (same identifier operators pass to `run log` / `tui log` on a live daemon).
- [ ] Failed admission preserved: `workflow.test.ts` `run workflow implement passes through daemon guard errors without local workflow logic`, `run workflow implement exits nonzero on an invalid daemon response`, and usage/validation rejects before daemon contact stay green (non-zero, named stderr, no run ID on stdout).
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — workflow stdout ordering: run ID at admission vs completion JSON.
- `v2/docs/operator-runbook.md` — copy the admission run ID for log/TUI while the workflow is live.
- `v2/docs/v1-behaviors.md` — admission run ID on stdout before attach wait (codify current contract).

## Prerequisites


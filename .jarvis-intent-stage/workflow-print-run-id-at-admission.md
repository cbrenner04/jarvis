---
name: workflow-print-run-id-at-admission
---

# Workflow launch prints the run ID at daemon admission

## Problem

`workflow.ts` already prints the workflow entry run ID on stdout immediately after a successful daemon `start`, before `waitForRunCompletion`. Operators and docs still treat early ID as the contract; regressions could reorder stdout, drop the line on some presets, or buffer it until wait completes. This intent hardens and tests that admission-time ordering — not first-time emission.

## Decisions

- Pin stdout order: workflow entry run ID line immediately after successful `start`, before any client-side completion wait and before terminal completion JSON; rules out moving ID to post-wait or preset-specific omission.
- Apply on every registered `jarvis run workflow` preset; rules out implement-only or attach-only emission.
- Preserve failed pre-admission validation and daemon `start` failures (non-zero exit, named stderr, no run ID line); rules out folding admission errors into attach semantics.
- No stdout before `start` beyond today's validation/stale-reset surfaces; flush so the ID line is observable before a long wait when buffering would matter.
- CLI-only; rules out daemon run lifecycle or IPC shape changes for this slice.
- Plan as **one spec** with four **ordered** subspecs on this seam (this intent → terminal wait → boundary progress → detach); plan subspec drafts detach default vs flag and unifies `write-behavior`, operator runbook, and `v1-behaviors` in one index.

## Acceptance criteria

- [ ] A regression test in `workflow.test.ts` drives each registered workflow preset through admitted `start` and asserts the workflow entry run ID is the first stdout line before any wait/completion JSON; it fails if ID is omitted, reordered after wait output, or not flushed pre-wait.
- [ ] `jarvis run log <id>` and `jarvis tui log <id>` accept the ID exactly as printed at admission while the workflow is still live.
- [ ] A failed admission still exits non-zero with the existing named failure (no run ID line).
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — workflow stdout ordering: run ID at admission vs completion JSON.
- `v2/docs/operator-runbook.md` — copy the admission run ID for log/TUI while the workflow is live.
- `v2/docs/v1-behaviors.md` — admission run ID on stdout before attach wait (codify current contract).

## Prerequisites


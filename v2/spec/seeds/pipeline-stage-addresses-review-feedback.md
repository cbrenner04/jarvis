---
name: pipeline-stage-addresses-review-feedback
---

# Pipeline stage re-entry addresses its PR's review feedback

## Problem

Owner decision 2026-09-30: review feedback must be applicable both through the standalone review-feedback preset and as a flag on a pipeline stage. Today an operator driving a pipeline must leave pipeline verbs and hand-assemble `jarvis run workflow <preset> --branch … --pipeline … --stage … [--branch-key …]` to fix a reviewed stage PR. The pipeline already knows each stage's lane, so the flag should resolve it.

## Decisions

- Surface: `jarvis pipeline resume <pipeline-id> [<branch-key>] --address-review <stage-id>`. Reuses the existing resume verb and its positional branch key; no new subcommand. Usage string and dispatcher parse the flag.
- With `--address-review`, resume does not re-dispatch the stage; it resolves that stage's completed lane (intent, plan, or implement; branch key when fanned out) and launches the review-feedback preset through the same admission as the standalone path. Every admission refusal (in flight, no review, merged/closed PR, wrong kind, capture failure) surfaces verbatim.
- Accepted whether the pipeline is terminal or not; pipeline state, stage rows, and gates are unchanged. The preset run is linked to the pipeline and stage for display only.
- The preset is still never a pipeline stage `workflow` value; this is re-entry on an existing stage, not a definition change.
- `--address-review` combined with `--reset-despite-dirty` or `--reset-despite-landed-criteria` is a usage error.

## Acceptance criteria

- [ ] CLI test with a fake IPC client: `pipeline resume <id> --address-review <stage>` sends a review-feedback launch carrying pipeline id, stage id, and branch key (when given), and does not send `pipeline_resume`; fails against the pre-fix dispatcher.
- [ ] Daemon-side test with fake store and fake `gh`: for a completed intent, plan, and implement stage with an open reviewed PR the launch admits against that stage's branch; an unknown stage, an unfinished stage, and a no-review PR each refuse by name; pipeline and stage rows are byte-identical before and after.
- [ ] Usage test: the flag with either reset flag, or with no stage id, prints `PIPELINE_RESUME_USAGE` and exits non-zero.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — addressing a pipeline stage's PR review via `pipeline resume --address-review`.
- `v2/docs/pipeline-execution.md` — flag semantics; pipeline state unchanged.

## Prerequisites

- The review-feedback preset chain from [[apply-pr-review-feedback-to-a-lane]] has landed: lane admission (completed intent/plan/implement lane, open PR with at least one review) and the write run that republishes to the same PR.

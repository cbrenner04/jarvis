# Pipeline resume `--address-review` CLI

## Primary implementation surface

cli

## Problem

`jarvis pipeline resume` always issues `pipeline_resume`; operators have no pipeline verb to launch review-feedback against a named succeeded stage on a live pipeline.

## Decision ledger

- Surface `--address-review <stage-id>` on `jarvis pipeline resume` alongside the existing branch positional and stale-reset override flags; rules out a new top-level pipeline subcommand or a standalone RPC-only entry.
- When `--address-review` is admitted, the resume branch sends `pipeline_stage_review_feedback_launch` with `{ pipelineId, stageId, branchKey? }` and never `pipeline_resume`; rules out overloading `pipeline_resume` params with a stage id.
- `branchKey` is included on the wire only when the operator supplied a non-blank `<branch-key>` positional; rules out inferring branch scope from the stage id alone on fan-out pipelines.
- `--address-review` combined with `--reset-despite-dirty`, `--reset-despite-landed-criteria`, or a missing/blank `--address-review` value is a usage error (`PIPELINE_RESUME_USAGE`, exit non-zero before daemon connect); rules out forwarding stale-reset overrides into review-feedback launch admission.
- Success parses the detached workflow `start` shape (`{ runId }`), prints `${runId}\n` on stdout, and exits `0`; rules out printing the pipeline id like ordinary `kind: "resumed"` resume.
- Admission and transport refusals from `pipeline_stage_review_feedback_launch` print on stderr via the same IPC error formatting as other pipeline commands and exit non-zero; rules out resume mutation `kind: "refused"` parsing for this path.
- Resume without `--address-review` keeps current positional arity, override flags, RPC params, stdout, and refusal contracts unchanged; rules out regressing branch-scoped resume or stale-reset forwarding.
- `PIPELINE_RESUME_USAGE`, `PIPELINE_RESUME_HELP_FLAGS`, and `help-flags-parity` for `pipeline resume` include `--address-review`; rules out help/usage drift from the parser.

## Tasks

- Extend `PIPELINE_RESUME_PARSE_ARG_OPTIONS` / `PIPELINE_RESUME_HELP_FLAGS` with `--address-review <stage-id>` and teach `parsePipelineResumeArgs` the mutual-exclusion and required-value rules above.
- Update `PIPELINE_RESUME_USAGE` and the `pipeline resume` branch in `runPipelineControlSubcommand` to dispatch `pipeline_stage_review_feedback_launch` when the flag is present, otherwise keep the existing `runPipelineMutationCommand("pipeline_resume", …)` path.
- Add `pipeline.test.ts` coverage for launch IPC params (with and without branch positional), usage rejection matrix, success stdout, and mutation checkpoints that `--address-review` cannot reach `pipeline_resume`.
- Align operator docs and v1 parity catalog with the new flag; cross-link runbook and `pipeline-execution.md` without duplicating daemon admission detail already documented under `pipeline_stage_review_feedback_launch`; runbook states this CLI path is detached start-only (`{ runId }` on stdout), not attached `jarvis run workflow review-feedback`.

## Acceptance criteria

- [x] `pipeline.test.ts` proves `pipeline resume <id> --address-review <stage>` sends exactly one `pipeline_stage_review_feedback_launch` frame with `pipelineId`, `stageId`, and optional `branchKey`, never `pipeline_resume`; fails against the pre-fix dispatcher reachable on main today.
- [x] `pipeline.test.ts` proves successful `pipeline resume <id> --address-review <stage>` prints exactly `${runId}\n` on stdout, exits `0`, and does not use ordinary resume stdout (`kind: "resumed"` / pipeline id); fails against the pre-fix dispatcher reachable on main today.
- [x] `pipeline.test.ts` proves `--address-review` with either stale-reset override flag, or with a missing or blank `--address-review` value when the flag is present, prints `PIPELINE_RESUME_USAGE` on stderr, exits non-zero, and opens no IPC client; fails against the pre-fix parser reachable on main today.
- [x] `pipeline.test.ts` — `pipeline resume exits 0 on resumed for pipe-failed`, `pipeline resume forwards the branch positional as branchKey`, `pipeline resume usage errors reject malformed branch arity before daemon connect`, and `help pipeline resume matches resume usage` stay green (ordinary resume unchanged).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `pipeline resume --address-review` syntax, fan-out pipelines requiring a positional branch key, operator recipe (detached review-feedback start via `{ runId }` stdout, not attached `jarvis run workflow review-feedback`, without resuming the pipeline).
- `v2/docs/pipeline-execution.md` — cross-link to the runbook for CLI `--address-review` semantics; keep daemon IPC detail in the existing `pipeline_stage_review_feedback_launch` section.
- `v2/docs/v1-behaviors.md` — **[v2 additive]** bullet for `jarvis pipeline resume … --address-review <stage-id>` routing to `pipeline_stage_review_feedback_launch` instead of `pipeline_resume`.

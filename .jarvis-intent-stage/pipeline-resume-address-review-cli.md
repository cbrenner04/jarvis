---
name: pipeline-resume-address-review-cli
---

# Pipeline resume `--address-review` routes to stage review-feedback launch

## Problem

`jarvis pipeline resume` always re-dispatches or resumes pipeline execution; operators have no pipeline verb to start review-feedback against a named succeeded stage.

## Decisions

- Surface: `jarvis pipeline resume <pipeline-id> [<branch-key>] --address-review <stage-id>` on the existing resume subcommand; usage string and parse options include `--address-review`.
- With `--address-review`, the CLI does not send `pipeline_resume`; it sends the daemon pipeline-stage review-feedback launch carrying pipeline id, stage id, and branch key when the operator supplied one positionally.
- `--address-review` combined with `--reset-despite-dirty`, `--reset-despite-landed-criteria`, or a missing stage id is a usage error (`PIPELINE_RESUME_USAGE`, non-zero exit).

## Acceptance criteria

- [ ] `pipeline.test.ts` (or equivalent CLI IPC test) proves `pipeline resume <id> --address-review <stage>` sends a review-feedback launch with pipeline id, stage id, and branch key when given, never `pipeline_resume`; it fails against the pre-fix dispatcher.
- [ ] A usage test proves `--address-review` with either reset flag, or with no stage id, prints `PIPELINE_RESUME_USAGE` and exits non-zero.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — addressing a pipeline stage's PR review via `pipeline resume --address-review`.

## Prerequisites

- `jarvis run workflow review-feedback` admits only a completed intent, plan, or implement lane (bare or pipeline-disambiguated), requires an open PR with at least one review, runs the capture prelude, and dispatches the write preset that republishes to the same PR.
- The daemon pipeline-stage review-feedback launch admits eligible succeeded workflow stages on reviewed open PRs, refuses ineligible targets by name, leaves pipeline and stage rows unchanged, and links the run for display only.

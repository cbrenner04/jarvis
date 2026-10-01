# Pipeline linked-stage lane PR settlement

## Problem

Linked stage settlement (`settleLinkedStagesFromEntryRunWith`) still applies the PR-evidence wedge (`completion_publication_missing_pr_evidence`) and generic failure projection when the entry invocation completed with `lanePrOutcome` or when publication failed on a list probe, so restart sweep, `pipeline resume`, and deferred settlement treat honest lane outcomes as publication-failed stages.

## Decisions

- When rollup is `completed` and durable rows carry merged lane PR evidence from subspec 00 (`prNumber`/`prUrl` from `lane_pr_merged`), final `ready`/`merge` workflow stages settle `succeeded` with that artifact — rules out `completion_publication_missing_pr_evidence` when publication intentionally withheld create for merged history.
- When rollup is `completed` and settlement evidence records `lane_pr_closed`, linked stages settle to a terminal non-failure outcome naming `lane_pr_closed` and the PR number without `status: "failed"` on the stage row — rules out stage `failed` with publication-missing or resumable republication detail for operator-closed lane PRs.
- When rollup is `failed` from a permanent list-probe publication failure on the cause run, linked stages settle `failed` with failure detail matching that run's publication failure message — rules out divergent stage diagnosis or publication-failed wording that omits the probe cause.
- Deferred to first consumer: daemon list/wait projection and notification sink copy for lane outcomes — pin when sibling intent `daemon-projects-lane-pr-settlement` implements; this subspec owns settlement writes only, not operator-error projection.

## Tasks

- [x] Extend PR-evidence resolution and/or stage settlement branches in `pipeline-stage-settlement.ts` (and any log-derived failure detail hook) for `lane_pr_merged`, `lane_pr_closed`, and list-probe failures aligned with durable run rows from subspec 00.
- [x] Add `pipeline-execution.test.ts` restart-sweep or resume-precondition fixtures with linked `running` stages per acceptance criteria (settlement logic only; not list/wait projection tests).
- [x] Update operator-facing docs for stage settlement per Documentation updates.

## Acceptance criteria

- [x] `pipeline-execution.test.ts`: entry run settled `completed` with merged PR evidence after `lane_pr_merged` publication settles a linked final `ready`/`merge` stage `succeeded` with that PR on the artifact, not `completion_publication_missing_pr_evidence`; fails against pre-fix stage failure reachable via `settlement fails when a ready pipeline's completed entry run lacks publication PR evidence`.
- [x] Same file: entry run settled with `lane_pr_closed` settles the linked stage to a terminal non-failure outcome with `lane_pr_closed` and the PR number, not `status: "failed"` with publication-missing code; fails against pre-fix publication-failed stage settlement.
- [x] Same file: entry run `failed` from a list-probe publication failure settles the linked stage `failed` with failure detail carrying the same probe message as the run row; fails against pre-fix mismatched or generic stage failure detail.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — resumed or recovered lanes whose newest PR is closed or merged settle linked stages on `lane_pr_closed` or `lane_pr_merged` (and merged PR evidence) instead of opening another draft; list-probe failures propagate probe text to stage failure detail.
- `v2/docs/v1-behaviors.md` — linked pipeline stage settlement for lane PR closed/merged and list-probe publication failure (behavior change vs pre-fix publication-failed stages).

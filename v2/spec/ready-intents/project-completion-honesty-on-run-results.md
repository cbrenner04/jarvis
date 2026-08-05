---
name: project-completion-honesty-on-run-results
---

# Run list and wait project completion-honesty settlements

Daemon operator errors and `jarvis run list` / `jarvis run wait` must surface write-loop
completion-honesty settlements from the prior intent — not a generic `completed` row or a
non-resumable `iteration_timeout` stop when durable logs carry richer settlement detail.

## Bundle

Third of three serial intents from `seeds/implement-completion-honesty`; promotes last after
`implement-stale-worktree-preflight-gates` and `refuse-false-completed-write-loop-settlements`.
Plan drafts one ordered spec from the bundle.

## Decisions

- `composeRunOperatorError` maps `iteration_timeout` to `nextAction: "resume"` when the terminal `loop_finished` record is resumable — rules out daemon demoting a resumable timeout back to `stop`.
- `run list` and `run wait` project the dirty-`no-work` non-`completed` status and name uncommitted paths from the same durable fields the write loop wrote — rules out CLI rows that still read `completed`.
- The completion inventory on `iteration_timeout` is exposed on the operator error object returned by both `list` and `wait` — rules out inventory that exists only in raw loop logs.
- Preserve existing `publicationFailure` and other operator-error fields when adding completion-honesty detail — rules out replacing structured diagnostics with message-only text.
- Bundle-terminal harness gate: the full `typecheck` / `check` / `lint:md` / `test:v2` / `test:integration:v2` AC lives only on this intent and assumes serial promotion last — rules out a green partial bundle when promotion order drifts.

## Acceptance criteria

- [ ] A regression asserts `run list` and `run wait` project a dirty-`no-work` refusal as a non-`completed` row naming the uncommitted paths; it fails against the current daemon mapping.
- [ ] A regression asserts `run list` and `run wait` report `resumable: true` / `nextAction: "resume"` for a completed-subspec `iteration_timeout` and `resumable: false` / `stop` when no subspec completed; inverting the completed-subspec predicate makes the regression red.
- [ ] A regression asserts the `iteration_timeout` operator error on `list` and `wait` carries the completion inventory naming completed and remaining subspec paths; it fails against baseline.
- [ ] `run-operator-error.test.ts` and the pinning `list`/`wait` integration test each link a `// @mutate` directive inverting the resumable `iteration_timeout` mapping; each mutation turns its test RED.
- [ ] Bundle-terminal: `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass after the prior two bundle intents are merged.

## Documentation updates

- `v2/docs/daemon-host.md` — document completion-honesty fields on `list`/`wait` operator errors and their coexistence with existing error shapes.
- `v2/docs/v1-behaviors.md` — record daemon projection of dirty-`no-work` refusals and resumable `iteration_timeout`.

## Prerequisites

- A write step that resolves `no-work` over uncommitted tracked paths settles a non-`completed` status naming those paths in its terminal loop record.
- `iteration_timeout` with at least one completed subspec writes `resumable: true` and a completion inventory to its terminal `loop_finished` record.
- `iteration_timeout` with no completed subspec writes `resumable: false` to its terminal `loop_finished` record.
- Resume of a completed-subspec timeout retains the branch, worktree, and prior iteration commits without `resetStaleWorkspace`.

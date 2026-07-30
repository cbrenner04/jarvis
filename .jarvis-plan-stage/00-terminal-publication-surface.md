# Terminal publication surface

## Problem

Completion publication can create and ready a PR, but no execution surface applies a configured `leave-draft`, `ready`, or `merge` terminal action against existing PR and worktree evidence while preserving ready-gate ordering.

## Prerequisites

- Project-pipeline resolution copies a validated `terminalAction` onto the admitted definition (`v2/spec/completed/20260730T091934Z-configure-and-validate-pipeline-terminal-action/`).
- Ready-gate and ready-flip seams exist in `v2/src/execution/ready-finalize.ts` (`createReadyFinalizer`, `ReadyGateError`).
- Workflow completion publication records `prNumber` and `prUrl` on the implement run (`completion-publisher.ts`, `workflow-runner.ts`).

## Decisions

- Add `executeTerminalPublication` in `v2/src/execution/terminal-publication.ts` as the sole terminal-action executor; rules out daemon or pipeline code issuing `gh` commands directly.
- Input carries `terminalAction`, `worktreePath`, `branch`, `baseRef`, `prNumber`, and `prUrl`; rules out re-running completion publish (push, draft create, body refresh).
- `leave-draft` returns success with unchanged PR evidence and performs zero ready-gate, ready-flip, or merge calls; rules out an implicit ready flip.
- `ready` and `merge` share one ready path: ready gate, then ready flip; rules out a merge-only gate skip.
- `merge` invokes merge only after the shared ready path succeeds; rules out merge before ready transition.
- A red ready gate fails before any ready flip or merge and surfaces gate failure; rules out merging or flipping a PR that failed readiness checks.
- Terminal publication runs ready gate and flip only, not the workflow-completion mutation or runtime-smoke verifier stack; rules out duplicating completion-finalization verifiers at the terminal boundary.
- Failure returns a typed error naming `terminalAction` and wrapping a normalized publication failure; PR evidence is retained and no close or delete runs; rules out cleanup that destroys recovery evidence.
- Injectable seams (`runReadyGate`, `ghReadyFlip`, `ghMerge`, publication retry helpers) back unit tests; rules out live `gh` in `terminal-publication.test.ts`.
- Deferred to first consumer: merge `gh` subcommand and flags, retry policy, and idempotency for already-ready or already-merged PRs — pin when the terminal publication adapter is implemented.

## Task checklist

- Add `terminal-publication.ts` with input/result types, failure type, and `executeTerminalPublication` (or factory with seams).
- Implement `leave-draft`, shared ready path, and merge branch with gate-before-mutation ordering.
- Add `terminal-publication.test.ts` with fake seams covering each action, red-gate suppression, mutation-failure preservation, and guard inversion.
- Document terminal-action ordering, shared ready gate, and failure preservation in `workflow-runner.md` and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `terminal-publication.test.ts` — `executes each configured terminal action in order` fails against the baseline, then drives leave-draft, ready, and merge once each against fake publication.
- [ ] `terminal-publication.test.ts` — `does not merge after a red ready gate` fails against the baseline, then confirms zero merge calls and turns RED when the gate guard is inverted.
- [ ] `terminal-publication.test.ts` — `retains PR evidence on terminal mutation failure` fails against the baseline, then reports the requested action and underlying error without closing or deleting the PR.
- [ ] Inverting the leave-draft no-mutation, red-gate-before-flip-or-merge, or failure-preservation guard makes `terminal-publication.test.ts` fail; negative cases prove spurious `gh` calls, merge after a red gate, and PR close or delete on mutation failure.

## Documentation updates

- `v2/docs/workflow-runner.md` — draft publication input, terminal action ordering, shared ready gate, and failure preservation.
- `v2/docs/v1-behaviors.md` — v2 terminal-publication behavior.

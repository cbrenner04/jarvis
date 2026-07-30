# Terminal publication surface

## Problem

Completion publication can create and ready a PR, but no execution surface applies a configured `leave-draft`, `ready`, or `merge` terminal action against existing PR and worktree evidence while preserving ready-gate ordering.

## Prerequisites

- Project-pipeline resolution copies a validated `terminalAction` onto the admitted definition (`v2/spec/completed/20260730T091934Z-configure-and-validate-pipeline-terminal-action/`).
- Ready-gate and ready-flip seams exist in `v2/src/execution/ready-finalize.ts` (`createReadyFinalizer`, `ReadyGateError`).
- Workflow completion publication records `prNumber` and `prUrl` on the implement run (`completion-publisher.ts`, `workflow-runner.ts`).

## Decisions

- Add `executeTerminalPublication` in `v2/src/execution/terminal-publication.ts` as the sole terminal-action executor; rules out daemon or pipeline code issuing `gh` commands directly.
- **Not invoked by production until settle lands** (`ready-intents/settle-pipeline-terminal-action.md`); full product semantics — especially `leave-draft` — require settle to wire completion + terminal publication serially; rules out treating missing pipeline integration as accidental scope slip.
- **Completion ↔ terminal composition is out of scope here** — a settle/upstream obligation: when `terminalAction` is `leave-draft`, completion must not run ready finalization before terminal publication (today `publishCompletionArtifacts` → `runReadyFinalizer` always flips); for `ready` and `merge`, terminal assumes completion produced `prNumber`/`prUrl` and re-runs gate plus idempotent ready flip at the settlement enforcement boundary, not the full completion verifier stack; rules out shipping a green executor that still fails configured `leave-draft` end to end.
- Input carries `terminalAction`, `worktreePath`, `branch`, `baseRef`, `prNumber`, and `prUrl`; rules out re-running completion publish (push, draft create, body refresh).
- `ready` and `merge` fail fast before any `gh` call when `prNumber` or `prUrl` is absent; `leave-draft` succeeds with optional passthrough evidence; rules out gate or merge against missing PR state.
- Success echoes retained `prNumber` and `prUrl`.
- `leave-draft` returns success with unchanged PR evidence and performs zero ready-gate, ready-flip, or merge calls; rules out an implicit ready flip.
- `ready` and `merge` share one ready path: ready gate, then ready flip; rules out a merge-only gate skip.
- `merge` invokes merge only after the shared ready path succeeds; rules out merge before ready transition.
- A red ready gate fails before any ready flip or merge and surfaces gate failure; rules out merging or flipping a PR that failed readiness checks.
- Terminal publication runs ready gate and flip only; **intentionally excludes** the completion verifier stack (`requiredIntegrationScope`, mutation/smoke verifiers); rules out duplicating completion-finalization verifiers at the terminal boundary.
- Failure returns a typed error naming `terminalAction` and wrapping a `PublicationFailure` from `normalizePublicationFailure`; PR evidence is retained and no close or delete runs; rules out cleanup that destroys recovery evidence.
- `ReadyGateError` maps into the wrapper via `normalizePublicationFailure(error.command, error)` — `operation` = `command`, `exitCode` = gate exit code, tails from gate `output`; `message` carries `gateFailureKind` and `timedOut` when set; out-of-scope classification (`gateFailureKind: "out_of_scope"`, `outsidePaths`) uses the same wrap path so settle and `v1-behaviors.md` stay consistent.
- Ready-flip and merge mutation failures use operation labels `"gh pr ready"` and `"gh pr merge"` respectively; merge `gh` subcommand flags remain deferred.
- Injectable seams (`runReadyGate`, `ghReadyFlip`, `ghMerge`, `ghClose`, `ghDelete` or a shared `gh` call log, publication retry helpers) back unit tests and non-vacuous guard inversion; rules out live `gh` in `terminal-publication.test.ts`.
- Deferred to first consumer: merge `gh` flags, retry policy, and idempotency for already-ready or already-merged PRs — pin when the terminal publication adapter is implemented.

## Task checklist

- Add `terminal-publication.ts` with input/result types, failure type, and `executeTerminalPublication` (or factory with seams).
- Implement `leave-draft`, shared ready path, and merge branch with gate-before-mutation ordering and missing-PR fail-fast.
- Add `terminal-publication.test.ts` with fake seams covering each action type once, red-gate suppression, gate and mutation failure preservation, missing-input fail-fast, and guard inversion.
- Document completion/terminal composition, terminal-action ordering, shared ready gate, failure classes, and settle handoff in `workflow-runner.md` and `v1-behaviors.md`.

## Acceptance criteria

- [x] `terminal-publication.test.ts` — `executes each terminal action type once against fake publication` fails against the baseline, then drives leave-draft, ready, and merge in separate cases (three invocations, not one pipeline running all three).
- [x] `terminal-publication.test.ts` — `does not ready-flip or merge after a red ready gate` fails against the baseline, then confirms zero ready-flip and zero merge calls and turns RED when the gate guard is inverted.
- [x] `terminal-publication.test.ts` — `retains PR evidence on ready gate failure` fails against the baseline, then reports the requested action and wrapped gate failure without closing or deleting the PR.
- [x] `terminal-publication.test.ts` — `retains PR evidence on terminal mutation failure` fails against the baseline, then reports the requested action and wrapped flip or merge failure without closing or deleting the PR.
- [x] `terminal-publication.test.ts` — `fails fast for ready and merge without PR evidence` fails against the baseline, then confirms zero `gh` calls when `prNumber`/`prUrl` are absent.
- [x] Inverting the leave-draft no-mutation, red-gate-before-flip-or-merge, or failure-preservation guard makes `terminal-publication.test.ts` fail; negative cases use injectable close/delete seams or a shared `gh` call log to prove spurious `gh` calls, merge or flip after a red gate, and PR close or delete on gate or mutation failure.
- [x] `workflow-runner.md` and `v1-behaviors.md` document completion/terminal composition, settle handoff, terminal failure classes (`ReadyGateError` wrap, `"gh pr merge"` label), and PR evidence retention on failure.

## Documentation updates

- `v2/docs/workflow-runner.md` — draft publication input, completion/terminal composition, settle handoff, terminal action ordering, shared ready gate, failure classes, and failure preservation.
- `v2/docs/v1-behaviors.md` — v2 terminal-publication behavior and failure wrapping.

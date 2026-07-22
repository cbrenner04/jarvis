# Report workflow terminal outcome on wait

An attached `jarvis run workflow implement` blocks on the entry run's daemon `wait`, which already awaits the full workflow promise and rolls up `runStatus`. When an earlier constituent row (typically the authored implement step) settles `completed` with `loopOutcomeKind: "complete"` but a later hidden finalization row fails mutation verification, `wait` still echoes the entry row's terminal log. `exitCodeForWaitResult` prefers `loopOutcomeKind` over `runStatus`, so the command prints `complete` and exits `0` while rollup is `failed`.

Completes deferred entry-row outcome projection left by [`01-daemon-wait-list-rollup`](../completed/20260714T023457Z-workflow-run-status-covers-every-step/01-daemon-wait-list-rollup.md): rollup status already covers every step; entry `wait`/`list` still echo the entry row's terminal record for outcome-carrying fields when a later sibling owns the terminal verdict.

## Prerequisites

- A surviving-mutation verification failure settles its owning shrink row as `failed`, `resumable`, and operator-visible with mutation detail (completed prerequisite spec).

## Decisions

- Re-source outcome-carrying fields only on workflow **entry** rows when rollup is terminal and the entry row's terminal `loop_finished` record disagrees with rollup on those fields; rules out rewriting non-entry rows or in-flight projections.
- Select the outcome owner with the same rollup stopping-step logic as status rollup (including hidden `~shrink` when it drives rollup `failed`); rules out ad-hoc sibling scans or first-failed-row heuristics.
- **In scope now:** hidden-finalization `surviving_mutation_failed` on the stopping shrink row after an earlier authored step `completed`. **Deferred:** other hidden-finalization publication failures (`completion_commit_failed`, `ready_gate_failed`) and later authored durable step failures — same projection seam, separate follow-up.
- **`ready_flip_failed` is out of scope:** rollup stays `completed`; entry projecting `complete` / exit `0` is correct.
- Entry-row `runStatus` stays on the existing rollup; only outcome-carrying fields re-source from the owner; rules out replacing rollup with one sibling's durable status.
- When re-sourcing, take from the owner's paired `(Run, loop_finished)` record: `loopOutcomeKind`, `error` (via `composeRunOperatorError` on the owner row + owner terminal record), `resumable` (owner row eligibility only), and `iterationsConsumed` at the publication boundary (not implement-only counts on the entry log).
- `resumeContextForRun` uses the entry row; entry `wait`/`list` share one selection and projection path; rules out list/wait drift or record-only patches that leave error/resume inconsistent.
- Project `resumable` only when the entry row itself is resume-eligible; rules out `resumable: true` on the printed entry id when `resume` still reads the entry log. Operator-runbook documents recovery via the owning shrink row from `jarvis run list` (prerequisite shrink-row resume).
- Reuse `exitCodeForWaitResult` / `buildWaitPayload` once `wait` returns corrected fields; rules out a workflow-local exit table in the CLI.
- Defer immediate run-ID print, detach, and run-boundary progress streaming to `workflow-commands-block-the-operator-terminal`; rules out duplicating that broader CLI attachment change here.

## Work

- Add a helper that, given an entry run, rollup status, and invocation siblings, selects the stopping step whose terminal `loop_finished` record owns the workflow outcome when entry projection would disagree with rollup.
- Wire the helper into workflow entry `wait` and entry-row `list` via the shared projection path.
- Add daemon regressions for implement-complete then hidden-shrink `surviving_mutation_failed`, plus a genuine multi-run success path (entry `wait` and `list`).
- Align workflow-runner, daemon-host, operator-runbook, and v1-behaviors docs with workflow-level terminal payload and recovery semantics.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-wait-run-completion.test.ts` regression `workflow entry wait and list report surviving_mutation_failed from hidden shrink after implement completes` drives implement `completed` plus shrink `surviving_mutation_failed`, asserts entry `wait` and entry `list` report `runStatus: "failed"`, `loopOutcomeKind: "surviving_mutation_failed"`, mutation detail, `resumable: false`, and owner-sourced `error.reason`; and fails against the pre-fix code.
- [x] The same regression asserts entry `list` exposes mutation detail and does not report `nextAction: "resume"` on the entry row (recovery is on the owning shrink row per operator-runbook).
- [x] Entry `wait`/`list` for a genuinely completed multi-run implement workflow (implement plus hidden shrink both `completed`, rollup `completed`) still report `loopOutcomeKind: "complete"` and exit `0`.
- [x] A `v2/src/commands/run.ts` row-formatting regression asserts the rendered `jarvis run list` row for a run carrying `survivingMutation`, `survivingMutationSourceFile`, and `survivingMutationSourceLine`, and separately for a run carrying none of them; each of the three added columns is pinned to its own value and position, so changing any one of their render expressions fails a test.
- [x] Every **optional-field spread** this change introduces is pinned in both directions: a payload built with the field present carries it, and a payload built with the field absent omits the key entirely. This covers the `entryResult.iterationsConsumed === undefined ? {} : { … }` and `entryResult.resumable === undefined ? {} : { … }` conditionals in `v2/src/daemon/daemon.ts`, and the enclosing `entryResult?.loopOutcomeKind !== undefined` spread. Assert key **absence** (e.g. `expect(payload).not.toHaveProperty("iterationsConsumed")`), not merely an undefined value — inverting the conditional yields a present-but-undefined key that a value assertion cannot distinguish. **A prior attempt (PR #1931) stalled here**: `operator-flip: === → !==` at `v2/src/daemon/daemon.ts:953`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — workflow entry `wait`/`list` derive outcome-carrying fields from the rollup stopping step, including hidden finalization rows.
- `v2/docs/daemon-host.md` — entry `wait`/`list` RPC semantics when outcome fields re-source from a sibling owner.
- `v2/docs/operator-runbook.md` — attached workflow exit and payload track workflow terminal outcome, not the first completed constituent run; surviving-mutation recovery resumes the owning shrink row from `jarvis run list`, not the printed entry id.
- `v2/docs/v1-behaviors.md` — changed v2 workflow command reporting contract.

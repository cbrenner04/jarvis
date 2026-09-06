# Failed plan resume staged-file paths

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts` (failed-plan redraft refusal and blocker messages that reference staged plan artifacts).

## Problem

Failed-plan resume refusals that mention staged plan content omit the resolved absolute path of the staged file. Operators guess between `.jarvis-intent-stage/` and `.jarvis-plan-stage/` folklore instead of opening the file the daemon actually inspected.

## Prerequisites

- Subspec 00 — failed plan resume harness preamble (operator-blocker and harness-draft-dirt refusal paths exist to annotate).

## Decision ledger

- Every failed-plan resume refusal or blocker message that references the staged plan file appends the resolved absolute path of that file; rules out relative-only or stage-directory folklore in operator-facing text.
- Staged plan file for plan-lane resume is always `.jarvis-plan-stage/intent.md` under the resolved write-step worktree; rules out intent-stage path leakage in plan-lane messages.
- Path suffix is appended to existing refusal text, not a separate log channel; rules out a second lookup step for operators.

## Tasks

- Resolve the write-step worktree path and join `.jarvis-plan-stage/intent.md` for plan-lane resume refusals that name staged plan content (operator blocker, and any other refusal constructible on main that references that file).
- Thread the absolute path into stale-reset stderr, stage `failureDetail.message`, and any resume-scoped operator-blocker text emitted before dispatch.
- Add regression coverage for operator-blocker refusal and at least one additional staged-file refusal constructible on main (for example a dirty-worktree refusal that still names the staged plan context when applicable).
- Update `pipeline-execution.md` to state the absolute-path contract.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` proves an operator-authored `## Blocker` still refuses and the refusal message contains the resolved absolute path of the staged `intent.md`; it fails against a message that omits the path (reachable on main: `refuseReopenedPlanOperatorBlocker` emits `operator blocker: staged plan carries an operator-authored ## Blocker` with no path).
- [x] `pipeline-execution.test.ts` proves every other failed-plan resume refusal that names the staged plan file constructible on main prints the resolved absolute path of that staged file; it fails against a message that omits the path (reachable on main: same `refuseReopenedPlanOperatorBlocker` site; add at least one additional constructible refusal in the same test file).
- [x] `v2/docs/pipeline-execution.md` documents absolute staged-file paths in failed-plan resume refusals and blockers.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — absolute staged `.jarvis-plan-stage/intent.md` path in every failed-plan resume refusal that references staged plan content.

---
name: daemon-linked-run-row-resume-admission
---

# Daemon linked run-row resume admission and projection honesty

## Module-boundary surface

- Daemon: resume reconstruction, admission, and operator projection in `v2/src/daemon/`

## Prerequisites

- Linked-row step-id grammar and snapshot base-step resolution live in one shared matcher adopted by the execution loop.
- Paused `<stepId>~link-N` resume re-enters the linked implement loop with `specReadRoot` and the active subspec threaded through write-loop input.
- `surviving_mutation_failed` resume redrives the owning review agent with the reprompt before mutation re-verification, or settles non-resumable with a named hand-finish action.

## Problem

`reconstructWriteResume` refuses paused `implement~link-N` rows (`resume_unsupported`), `implement~shrink` `completion_commit_failed` resume returns success without an attempt or log record, and `resumable`/`nextAction` projection advertises `resume` on rows daemon admission cannot drive.

## Decision ledger

- `reconstructWriteResume` resolves snapshot steps through the shared write-sibling matcher; rules out daemon-only `~shrink` suffix matching while the runner mints `~link-N`.
- Every daemon resume path records an attempt plus `iteration_started` on replay, or refuses with a named reason; rules out a silent `ok` response that changes no durable state (#3462).
- `resumable` and `nextAction` derive from what resume admission actually accepts; rules out projection advertising `resume` on rows every verb refuses (same honesty mechanism as [[terminal-state-honesty-invariant]]).

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` proves `run resume` on a paused `implement~link-N` row re-enters the linked loop and dispatches the next subspec; it fails against the current `resume_unsupported` refusal (#3463).
- [ ] `v2/src/daemon/daemon-resume.test.ts` proves `run resume` on a `completion_commit_failed` `implement~shrink` row records an attempt and re-runs finalization replay, or refuses with a named reason; it fails against the current silent no-op (#3462).
- [ ] A projection test proves rows resume admission refuses do not advertise `nextAction: "resume"`; it fails while stale `resumable: true` records still project resume.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — resume behavior on linked rows; retire the force-kill-and-reopen workaround.
- `v2/docs/v1-behaviors.md` — record daemon linked-row resume admission and projection honesty.

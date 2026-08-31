---
name: pipeline-resume-auto-clears-blocked-plan-lane-dirt
---

# Pipeline resume auto-clears a blocked plan lane's dirty worktree

## Prerequisites

- Pipeline re-dispatch runs shared `maybeResetStaleWorkspace` stale-reset preflight before workflow write-step dispatch.
- Intent-stage pipeline re-dispatch auto-clears a poisoned managed worktree when stale-reset gates pass.
- Standalone `plan`/`implement` re-run dirty-reuse and landed-criteria gates live in `resetStaleWorkspace`.

## Primary implementation surface

- daemon

## Problem

- `pipeline resume <id> <branch-key>` on a failed fan-out plan lane refuses at the dirty-reuse gate while the lane worktree holds uncommitted draft paths — the normal blocked-plan state — forcing manual `jarvis cleanup --abandon` before redraft can proceed.
- Intent-stage re-dispatch already auto-clears when gates pass; failed plan-stage redraft does not, though resume discards the dirty tree anyway.

## Decisions

- A redraft-resume of a `failed` plan stage treats its own worktree as disposable and auto-clears (reset from base, same path as intent-stage re-dispatch) before the plan write step; rules out requiring manual `cleanup --abandon` for the ordinary blocked-lane case.
- `pipeline recover` lands a corrected staged tree and must not auto-clear; recover is out of scope for auto-clear in this intent.
- Preserve refusals when a live run holds the lane worktree, an operator `## Blocker` remains in the staged tree, or worktree HEAD is not a descendant of base — name the blocking state on stderr; rules out auto-clear overriding those guards even when reset-override RPC parameters are supplied.
- `pipeline resume`/`recover` daemon handlers accept reset-override RPC parameters and thread each into the shared stale-reset gate flags on resume dispatch; recover accepts the same RPC fields for forwarding parity only (recover does not invoke stale-reset preflight today); positive operator-supplied override behavior is deferred to intent 2 CLI admission.
- Scope: `pipeline resume` whole-pipeline and branch-scoped forms; auto-clear applies to `failed` plan stages on resume only; do not change standalone `plan`/`implement` re-run gates or the intent-stage path.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` drives `pipeline resume <id> <branch-key>` on a `failed` plan lane whose worktree holds uncommitted draft paths, asserts auto-clear rematerializes from base and dispatches the plan write step without manual `cleanup --abandon`, and fails against the pre-fix dirty-reuse refusal.
- [ ] `pipeline-execution.test.ts` proves resume still refuses, naming the blocking state, when a live run holds the lane worktree, an operator `## Blocker` section remains in the staged tree, or worktree HEAD is not a descendant of base, even when reset-override RPC parameters are supplied; fails against any path that auto-clears through those guards.
- [ ] `pipeline-execution.test.ts` — `pipeline intent-stage re-dispatch resets a poisoned worktree before the write step` and `workflow.test.ts` standalone `plan`/`implement` re-run stale-reset tests (`run workflow implement refuses reset when the managed worktree is dirty`, `run workflow plan resets a stale worktree before daemon start`, and related pinning cases) stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume: a blocked plan lane's dirty worktree is auto-cleared on redraft-resume; manual `cleanup --abandon` remains only for preserved-refusal cases (live run, remaining `## Blocker`, descendant-check).
- `v2/docs/v1-behaviors.md` — record pipeline failed-plan-lane auto-clear on resume.

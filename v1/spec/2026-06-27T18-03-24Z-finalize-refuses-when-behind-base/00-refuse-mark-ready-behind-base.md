# Refuse `triage --mark-ready` when branch is behind base

## Problem

`jarvis1 triage <worktree> --mark-ready` finalizes a complete worktree: commit
dirty changes, ensure/open a draft PR, run the ready gate once, flip ready on
green. It does not check whether the branch contains its base before committing
or gating. A branch behind an advanced base can pass the local gate yet ready
code that was never validated against current base — the same stale-merge risk
the draft→ready guard blocks in patch/plan mode, but finalize can still commit
and gate first.

When the branch does not contain its base, refuse finalize up front: emit
`behind base, resolve then re-invoke`, exit non-zero, perform no commit, PR
open, gate, or ready flip. Integration-merge and conflict resolution stay out
of scope; the operator resolves base drift, then re-invokes `--mark-ready`.

## Decisions

- Scope is `triage --mark-ready` only — rules out extending `--merge` in this subspec; merge has its own pre-checks and operator path.
- Pre-check order: completeness → behind-base → DRAFT guard → commit/push → ensure/open PR → gate → ready — rules out behind-base after DRAFT or after commit/push.
- Refactor `v1/src/git/base-current.ts` so PR and no-PR paths share one fetch+ancestor verdict: PR base from `gh pr view` `baseRefName`; no PR from `getBaseBranch`; `git merge-base --is-ancestor origin/<base> HEAD` exit non-zero means behind **or** diverged — rules out calling today's `checkBaseCurrent` unchanged (no-PR soft-fails on missing PR) or a triage-local duplicate with divergent soft-fail coverage.
- PR path: `gh pr view` or fetch failure soft-fails to proceed (same as ready-flip guard) — rules out refusing finalize on transient `gh`/fetch errors.
- No-PR path: `getBaseBranch` always returns a string; only fetch or ancestor git errors soft-fail to proceed — rules out treating no-PR base resolution as uncertain.
- Refusal is a hard exit (non-zero) with stderr `triage --mark-ready: behind base, resolve then re-invoke` — rules out warn-and-continue or flipping ready after a failed check.
- Injectable base-current seam on the triage mark-ready path (default: real helper) — rules out only exercising the happy path via integration fixtures.
- `--merge` unchanged — rules out coupling merge pre-checks to this finalize slice.

## Task checklist

- [ ] After completeness and before the DRAFT guard in `triageMarkReady`, resolve base (PR `baseRefName` when a PR exists, else `getBaseBranch`) via the unified base-current helper and refuse on behind/diverged.
- [ ] On behind/diverged: emit the refusal message, return non-zero; do not commit, push, open a PR, run the gate, or call `gh pr ready`.
- [ ] Refactor `base-current.ts` so PR and no-PR paths share one fetch+ancestor implementation; wire injectable seam on the mark-ready path (default: real helper).
- [ ] Extend `v1/test/triage-command.test.ts`: behind with open PR → refusal, no commit/push/gate/ready; behind with no PR (`getPrState: () => null`) → refusal, no `ensureDraftPr`/gate/`prReady`; clean tree with unpushed commits behind base → no push/gate/ready.
- [ ] On existing no-PR happy-path tests, inject explicit `current` (or equivalent) on the base-current seam; `triage-command.test.ts` `--mark-ready when no PR exists opens draft PR, gates, and promotes` stays green once injection is wired.
- [ ] Update docs (below).

## Acceptance criteria

- [ ] When `jarvis1 triage <worktree> --mark-ready` runs on a complete worktree whose branch is behind or diverged from its base (open PR), the command exits non-zero, stderr includes `behind base, resolve then re-invoke`, and it performs no finalize commit, push, PR open, ready gate, or ready flip.
- [ ] When complete, no open PR, and branch is behind the default base (`getBaseBranch`), the command exits non-zero with the same message and performs no `ensureDraftPr`, gate, or `prReady`.
- [ ] When the branch is current with or ahead of its base, `--mark-ready` finalize behavior is unchanged (dirty commit, ensure/open draft PR, single gate, ready on green).
- [ ] Behind-base refusal runs after completeness and before the DRAFT guard — a behind tree with uncommitted changes leaves those changes uncommitted; a behind clean tree with unpushed commits performs no push, gate, or ready flip; any existing PR stays draft.
- [ ] PR path: `gh pr view` or fetch failure does not refuse finalize (proceeds as today). No-PR path: fetch or ancestor git errors do not refuse finalize; `getBaseBranch` resolution does not soft-fail.
- [ ] `triage-command.test.ts` `--mark-ready when no PR exists opens draft PR, gates, and promotes` stays green with base-current injection wired; other current-with-base `--mark-ready` tests stay green (incompleteness refusal, DRAFT guard, dirty finalize, gate failure, and related seams).

## Documentation updates

- `v2/docs/v1-behaviors.md`: update the `--mark-ready` entry — refuses before side effects when behind or diverged from base (resolve-then-re-invoke message); note PR-path `gh`/fetch soft-fail proceed and no-PR-path fetch/ancestor soft-fail proceed (parity with draft→ready guard). (Required: changes existing v1 behavior.)
- `v1/docs/operator-runbook.md`: under manual-finalize recovery, note that `--mark-ready` refuses when behind base; operator must integrate/rebase onto current base, then re-invoke.
- `v1/docs/run-loop.md`: in the `--mark-ready` finalize paragraph, note behind-base refusal after completeness and before DRAFT/commit/gate.

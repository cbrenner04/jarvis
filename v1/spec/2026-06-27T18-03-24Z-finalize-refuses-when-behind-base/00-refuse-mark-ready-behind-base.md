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
- Behind-base refusal runs after the completeness check and before any side effect (commit, PR open, gate, ready) — rules out partial finalize that leaves a finalize commit or opened PR on a drifted tree.
- Reuse the `checkBaseCurrent` verdict (`v1/src/git/base-current.ts`): `git merge-base --is-ancestor origin/<base> HEAD` exit non-zero means base not contained (behind **or** diverged); both refuse — rules out fast-forward-only or behind-only interpretation that would still gate diverged trees.
- Base ref is the open PR's `baseRefName` when a PR exists; when no PR exists, resolve via `getBaseBranch` and run the same ancestor test — rules out skipping no-PR worktrees that are behind the default base (plain `checkBaseCurrent` soft-fails when `gh pr view` fails).
- Fetch/base-resolution failure soft-fails to proceed (same as the ready-flip guard) — rules out stranding every finalize on transient `gh`/`git` errors when base currency cannot be determined.
- Refusal is a hard exit (non-zero) with stderr `triage --mark-ready: behind base, resolve then re-invoke` — rules out warn-and-continue or flipping ready after a failed check.
- Add an injectable base-current seam on the triage command path (default: real helper) so tests drive behind/current without live remotes — rules out only exercising the happy path via integration fixtures.
- `--merge` unchanged — rules out coupling merge pre-checks to this finalize slice.

## Task checklist

- [ ] After the completeness refusal in `triageMarkReady`, resolve base currency (PR base when a PR exists, else `getBaseBranch`) and run the shared ancestor check before commit/push.
- [ ] On behind/diverged: emit the refusal message, return non-zero; do not commit, open a PR, run the gate, or call `gh pr ready`.
- [ ] Wire an injectable `checkBaseCurrent` (or equivalent) seam on the triage mark-ready path; default to the real helper.
- [ ] Extend `v1/test/triage-command.test.ts`: behind → refusal with message, no commit/gate/ready side effects; current-with-base → existing finalize paths unchanged.
- [ ] Update docs (below).

## Acceptance criteria

- [ ] When `jarvis1 triage <worktree> --mark-ready` runs on a complete worktree whose branch is behind or diverged from its base, the command exits non-zero, stderr includes `behind base, resolve then re-invoke`, and it performs no finalize commit, opens no PR, runs no ready gate, and does not flip the PR ready.
- [ ] When the branch is current with or ahead of its base, `--mark-ready` finalize behavior is unchanged (dirty commit, ensure/open draft PR, single gate, ready on green).
- [ ] The behind-base refusal runs before any finalize side effect on a complete worktree — a behind tree with uncommitted changes leaves those changes uncommitted and any existing PR draft.
- [ ] A failure to resolve or fetch the base does not refuse finalize (proceeds as today).
- [ ] `v1/test/triage-command.test.ts` `--mark-ready` tests stay green for the current-with-base paths (incompleteness refusal, DRAFT guard, dirty finalize, gate failure, and related seams).

## Documentation updates

- `v2/docs/v1-behaviors.md`: update the `--mark-ready` entry — refuses before side effects when the branch is behind or diverged from base, with the resolve-then-re-invoke message. (Required: changes existing v1 behavior.)
- `v1/docs/operator-runbook.md`: under manual-finalize recovery, note that `--mark-ready` refuses when behind base; operator must integrate/rebase onto current base, then re-invoke.
- `v1/docs/run-loop.md`: in the `--mark-ready` finalize paragraph, note the behind-base refusal before commit/gate.

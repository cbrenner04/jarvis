# Guard ready flip on base-current check

## Problem

Both patch (`maybeMarkReady`, `v1/src/modes/patch/pr.ts`) and plan
(`maybeMarkPlanPrReady`, `v1/src/modes/plan/pr.ts`) run the local ready gate and
then call `gh pr ready <branch>`. Neither confirms the branch contains its base.
A branch can pass the local gate yet be behind an advanced base, so the flip
marks ready a stale branch that merges into untested state or conflicts.

Add a base-current guard: before flipping draft→ready, confirm the branch is not
behind its PR base. If behind, do not flip, surface it, leave the PR draft.

## Decisions

Base ref is the PR's actual base (`gh pr view --json baseRefName`), not assumed `main` — a PR may target a non-default base.
Compare against a best-effort-fetched `origin/<base>`, not the local ref — a stale local ref yields false "current" verdicts.
Behind test: `git merge-base --is-ancestor origin/<base> HEAD` — exit 0 = base contained (not behind, proceed); non-zero = behind (block). Rules out a brittle `rev-list --count` parse.
Guard runs before the local ready gate, not after — fail fast, skip wasted gate work and check:fix commits on a branch that won't flip.
Behind-base does not throw: emit a stderr message and return, leaving the PR draft. Throwing would crash the patch run; the contract is "leave draft", not "abort".
Guard sits before the `markReady` test seam short-circuit in both functions, so the injected-seam path is gated too.
Add an injectable behind-check seam (default: real git/gh) so tests drive both verdicts without a live remote.
Fetch/base-resolution failure is treated as not-behind (proceed) — a transient `gh`/`git` error must not strand every PR in draft.

## Task checklist

- [ ] Add a shared behind-base helper (PR base ref → fetch → `merge-base --is-ancestor`).
- [ ] Wire the guard into `maybeMarkReady` (patch) before the gate and `markReady` short-circuit.
- [ ] Wire the guard into `maybeMarkPlanPrReady` (plan) before the gate and `markReady` short-circuit.
- [ ] Emit a stderr message naming branch and base when blocked.
- [ ] Tests: behind → no `gh pr ready`, draft preserved, message emitted; current → flip proceeds (both modes).

## Acceptance criteria

- [ ] When the patch-mode branch is behind its PR base at ready time, the harness does not call `gh pr ready` and the PR stays draft.
- [ ] When the plan-mode branch is behind its PR base at ready time, the harness does not call `gh pr ready` and the PR stays draft.
- [ ] A behind-base block surfaces an operator-visible stderr message naming the branch and its base.
- [ ] When the branch is current with or ahead of its base, the ready flip proceeds as before (gate runs, `gh pr ready` is called) in both modes.
- [ ] The base comparison resolves the PR's actual base ref and compares against a freshly-fetched remote base, not a stale local ref.
- [ ] A failure to resolve or fetch the base does not block the flip (proceeds rather than stranding the PR draft).
- [ ] `v1/test/modes/patch/pr.sandbox-unrunnable.test.ts` ready-flip tests stay green for the current-with-base path (behavior unchanged when not behind).
- [ ] `v1/test/modes/plan/pr.sandbox-unrunnable.test.ts` ready-flip tests stay green for the current-with-base path (behavior unchanged when not behind).

## Documentation updates

- [ ] `v1/docs/run-loop.md`: note the patch-mode ready flip is guarded by a base-current check (behind base → no flip, PR stays draft).
- [ ] `v1/docs/plan-mode.md`: note the plan-mode ready transition is guarded by the same base-current check.
- [ ] `v2/docs/v1-behaviors.md`: record the base-current guard on the draft→ready flip for both modes (changes existing ready-flip behavior).

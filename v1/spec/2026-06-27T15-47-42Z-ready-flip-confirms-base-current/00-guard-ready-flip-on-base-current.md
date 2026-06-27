# Guard ready flip on base-current check

## Problem

Both patch (`maybeMarkReady`, `v1/src/modes/patch/pr.ts`) and plan
(`maybeMarkPlanPrReady`, `v1/src/modes/plan/pr.ts`) run the local ready gate and
then call `gh pr ready <branch>`. Neither confirms the branch contains its base.
A branch can pass the local gate yet be behind an advanced base, so the flip
marks ready a stale branch that merges into untested state or conflicts.

Add a base-current guard: before flipping draft→ready, confirm the branch
contains its PR base. If it is behind or diverged, do not flip, surface it,
leave the PR draft.

The guard is best-effort, not a hard barrier: the base can advance after the
check and before the flip (TOCTOU), and fetch errors soft-fail to proceed
(below). A post-guard stale merge is expected, not a guard bug — it narrows the
window, it does not close it.

## Decisions

Helper lives in `v1/src/` (e.g. `v1/src/git/base-current.ts`), not `shared/` — both consumers are v1; defer a `shared/` move to the first v2 caller.
Base ref is the PR's actual base (`gh pr view --json baseRefName`), not assumed `main` — a PR may target a non-default base.
Remote is assumed to be `origin`; a missing/misnamed remote falls into the fetch-failure soft-fail path below. Rules out probing for the remote name.
Compare against a best-effort-fetched `origin/<base>`, not the local ref — a stale local ref yields false "current" verdicts.
Behind/diverged test: `git merge-base --is-ancestor origin/<base> HEAD` — exit 0 = base contained (proceed); non-zero = base not contained, i.e. behind OR diverged (block). Diverged is blocked identically to behind: a diverged branch has base commits absent from HEAD, the same root problem. No fast-forward-only interpretation. Rules out a brittle `rev-list --count` parse.
Guard runs before the local ready gate, not after — fail fast, skip wasted gate work and check:fix commits on a branch that won't flip.
Block does not throw: emit a stderr message and return, leaving the PR draft. Throwing would crash the patch run; the contract is "leave draft", not "abort".
Guard sits before the `markReady` test seam short-circuit in both functions, so the injected-seam path is gated too. Consequence: existing tests that inject `markReady` must also inject `checkBaseCurrent` (else they hit real git/gh); the seam contract now requires co-injection.
Add an injectable base-current seam (default: real git/gh) so tests drive all verdicts without a live remote.
Fetch/base-resolution failure (including missing remote) is treated as base-contained (proceed) — a transient `gh`/`git` error must not strand every PR in draft.

## Task checklist

- [ ] Add a `v1/src/` base-current helper (PR base ref → fetch `origin/<base>` → `merge-base --is-ancestor`).
- [ ] Wire the guard into `maybeMarkReady` (patch) before the gate and `markReady` short-circuit.
- [ ] Wire the guard into `maybeMarkPlanPrReady` (plan) before the gate and `markReady` short-circuit.
- [ ] Emit a stderr message naming branch and base when blocked.
- [ ] Update existing `markReady`-injecting fixtures in both `pr.sandbox-unrunnable.test.ts` files to co-inject `checkBaseCurrent` (base-contained) so the current-with-base path stays green.
- [ ] Tests: behind → no `gh pr ready`, draft preserved, message emitted; diverged → blocked identically; current/ahead → flip proceeds; fetch/base-resolution failure → flip proceeds (both modes).

## Acceptance criteria

- [ ] When the patch-mode branch is behind or diverged from its PR base at ready time, the harness does not call `gh pr ready` and the PR stays draft.
- [ ] When the plan-mode branch is behind or diverged from its PR base at ready time, the harness does not call `gh pr ready` and the PR stays draft.
- [ ] A block surfaces an operator-visible stderr message naming the branch and its base.
- [ ] When the branch is current with or ahead of its base, the ready flip proceeds as before (gate runs, `gh pr ready` is called) in both modes.
- [ ] The base comparison resolves the PR's actual base ref and compares against a freshly-fetched `origin/<base>`, not a stale local ref.
- [ ] A failure to resolve or fetch the base (including a missing remote) does not block the flip (proceeds rather than stranding the PR draft).
- [ ] After the guard is wired in, the current-with-base ready-flip tests in `v1/test/modes/patch/pr.sandbox-unrunnable.test.ts` pass — updating the `markReady`-injecting fixtures to co-inject `checkBaseCurrent` (base-contained) so flip behavior is unchanged when not behind.
- [ ] After the guard is wired in, the current-with-base ready-flip tests in `v1/test/modes/plan/pr.sandbox-unrunnable.test.ts` pass — with the same `checkBaseCurrent` co-injection on existing `markReady`-injecting fixtures.

## Documentation updates

- [ ] `v1/docs/run-loop.md`: note the patch-mode ready flip is guarded by a base-current check (behind base → no flip, PR stays draft).
- [ ] `v1/docs/plan-mode.md`: note the plan-mode ready transition is guarded by the same base-current check.
- [ ] `v2/docs/v1-behaviors.md`: record the base-current guard on the draft→ready flip for both modes (changes existing ready-flip behavior).

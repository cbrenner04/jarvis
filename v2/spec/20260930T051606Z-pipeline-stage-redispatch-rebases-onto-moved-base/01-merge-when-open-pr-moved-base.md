# 01 — Merge base into lane when open PR and moved base

## Problem

When a draft PR already published the lane tip, rebasing onto a moved base rewrites history the remote tip no longer descends from, forcing `--force-with-lease` on the next push. In-root moved-base continuation today rebases regardless of PR state; out-of-root continuation from [00](00-continuation-readable-out-of-root-rebase.md) needs the same open-PR branch: merge base into the lane instead of rebasing.

## Decisions

- `evaluateCommittedLaneContinuation` receives `hasOpenPr` from the existing `prGate` outcome in `resetStaleWorkspace`; callers (`maybeResetStaleWorkspace`, CLI, daemon pipeline preflight) stay unchanged — rules out a parallel open-PR signal.
- Open draft PR (`prGate.pr` defined) on a continuation-readable lane behind moved base: merge base into the lane in the managed worktree instead of rebasing, so the prior tip stays an ancestor of the new tip — rules out rebasing as the only moved-base path when a PR already published the lane tip; applies lane-wide (in-root and out-of-root), not scoped to chained fixtures only.
- Omit `preRebaseSha` on merge continuation; `maybeResetStaleWorkspace` sets `writeStep.leaseFromSha` only from `preRebaseSha` on rebase-continue and omits it on merge-continue — rules out lease pushes keyed on a rewritten tip after merge.
- Merge conflicts abort with tree and branch unchanged; refusal reuses the rebase-conflict template (base, conflicting paths, `jarvis cleanup --abandon <branch>`) — rules out partial application; operator docs must describe merge aborts, not only “rebase onto base” failures.
- Deferred to first consumer: rebase-with-open-PR after merge-primary path — pin if an implementation rebases with open PR (`leaseFromSha` must equal pushed remote tip or refuse foreign-tip semantics per intent).
- Out-of-root lanes still skip `evaluateContinuationTickBacking` per [00](00-continuation-readable-out-of-root-rebase.md); merge/rebase eligibility still uses continuation-readable gating only.

## Tasks

- [ ] Implement merge-base-into-lane for the open-PR moved-base path (symmetric abort-on-conflict to `rebaseWorktreeOntoBase`); wire `hasOpenPr` into `evaluateCommittedLaneContinuation`; omit `preRebaseSha` on merge continuation.
- [ ] Reuse or extend [00](00-continuation-readable-out-of-root-rebase.md) chained out-of-root temp-git fixtures for open-PR merge tests; add in-root moved-base + faked open draft PR fixture.
- [ ] Update `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — merge-when-PR-published and merge-aware conflict refusals.
- [ ] Update `v2/docs/v1-behaviors.md` incomplete re-dispatch continuation — merge-when-open-PR (replace rebase-with-open-PR-only guidance).
- [ ] Update `v2/docs/write-behavior.md` — merge continuation vs rebase continuation; when `leaseFromSha` / `preRebaseSha` is set vs omitted on `continue`.

## Acceptance criteria

- [ ] `cleanup.test.ts` test `resetStaleWorkspace merges base into an open-PR out-of-root lane past a moved base` uses the chained out-of-root fixture with a faked open draft PR; asserts `status: "continue"`, old tip is ancestor of new tip, no rebase (`git rev-parse ORIG_HEAD` fails in the worktree after success), no `preRebaseSha`, and worktree retained; fails against the pre-fix rebase-only path (reachable on main: no merge-continuation path).
- [ ] `cleanup.test.ts` test `resetStaleWorkspace merges base into an open-PR in-root lane past a moved base` uses an in-root continuation-readable spec, faked open draft PR, and moved base; asserts `status: "continue"`, old tip ancestor of new tip, no rebase (`ORIG_HEAD` absent), no `preRebaseSha`, worktree retained; fails against the pre-fix rebase-only path (reachable on main: `evaluateCommittedLaneContinuation` always rebases today).
- [ ] `cleanup.test.ts` test `resetStaleWorkspace aborts a conflicting merge for an open-PR out-of-root moved-base lane` asserts refusal naming conflicting paths, branch tip and worktree porcelain unchanged from before the attempt; fails against the pre-fix code (reachable on main: no merge-continuation path exists).
- [ ] `stale-reset-workspace.test.ts` or `cleanup.test.ts` asserts `maybeResetStaleWorkspace` sets `writeStep.leaseFromSha` from `preRebaseSha` on rebase-continue and does not set it on merge-continue when exercising moved-base continuation (fails if merge-continue copies a rebase lease).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — merge-when-PR-published for in-root and chained out-of-root lanes; merge-aware abort wording (not rebase-only).
- [ ] `v2/docs/v1-behaviors.md` — incomplete re-dispatch continuation: merge-when-open-PR vs rebase when no PR.
- [ ] `v2/docs/write-behavior.md` — `preRebaseSha` / `leaseFromSha` on rebase-continue vs omitted on merge-continue.

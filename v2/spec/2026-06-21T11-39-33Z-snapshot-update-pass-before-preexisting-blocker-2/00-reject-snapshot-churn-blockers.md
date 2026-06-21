# 00 — Reject claim blockers when an injected snapshot-update re-test passes

## Problem

`runIteration` validates a newly added pre-existing-failures `## Blocker` against
the base ref before committing it and exiting 7 (`v1/src/modes/patch/iteration.ts:758-894`).
When base-ref validation does **not** reject (base reproduces the failure, seam
absent, git off, or bound hit), the blocker stands today. But the observed failures
were outdated snapshots that reproduce at base too — running an update-snapshots
pass and re-testing in the agent worktree clears them.

This subspec adds the snapshot-churn rejection decision and wires it into the
claim-blocker-stands path behind an injected async seam. The real update + re-test
runner lands in `01`.

## Decisions

- Gate is placed **inside the specific branch** reached when: the blocker is a claim (`detectBlockerClaim`), git is on, the shared bound is not hit, and base-ref validation **ran and went red** (did not reject) — *not* in the shared commit + exit-7 block that the base-ref-red branch, the non-claim branch, the git-off branch, and the bound-hit branch all fall through to. Placing it in that shared block would fire it for non-claim or bound-hit blockers. Rules out: a second gate on non-claim blockers (most blockers are real); re-running snapshot churn for a blocker base-ref already cleared (wasted full re-test); firing in the shared commit path.
- Base-ref/snapshot-seam coupling is **subordinate, not peer**: the snapshot gate is structurally reachable only inside the guard where the base-ref validation seam was wired and executed non-rejecting. Production wires **both** seams together, so "base-ref ran" is guaranteed whenever the snapshot gate runs. The "shares the bound" language is about the counter, not co-equal placement. Rules out: reading the two gates as independent peers and placing the snapshot gate where base-ref never ran.
- Gate sits **after** base-ref validation, not before. Base-ref runs read-only in a throwaway worktree; this gate mutates the agent worktree. Only mutate when the cheaper non-mutating check did not clear the blocker. Rules out: mutating the worktree before the read-only check has had a chance to reject for free.
- Re-test green ⇒ snapshot churn ⇒ reject: strip the `## Blocker` section via `stripBlockerSection`, emit a distinct rejection telemetry event, log to stderr, increment the shared rejection counter, and continue the loop (no exit 7, no blocker commit). Rules out: leaving the `## Blocker` in place (next iteration re-trips).
- Updated snapshot files are **intentionally left dirty** in the agent worktree; the normal iteration/completion commit absorbs them (operator catches issues at review, per the undefer decision). Rules out: running the update in a throwaway worktree (the corrected snapshots are part of the work and must persist).
- Seam: `opts.runSnapshotUpdateRetest?: () => Promise<boolean>` (true = re-test green after the update pass). No args — the default impl closes over the agent working dir, mirroring `runBaseRefTests`'s wiring in `run.ts`. Default when absent = **fail-safe: blocker stands**. Rules out: a sync seam `01` would have to break for real async work; making exit 7 depend on an unimplemented runner.
- Rejection is bounded by the **existing** per-subspec counter (`state.consecutiveBlockerClaimRejections` / `BLOCKER_CLAIM_REJECTION_BOUND`) shared with base-ref rejections — a claim-blocker rejection is one rejection regardless of which gate fired. Once the bound is hit, the next matching claim blocker stands instead of re-running the expensive update + re-test. Rules out: a separate unbounded counter that lets the two gates alternate and re-trip indefinitely.
- Counter ordering: the base-ref-red branch the gate lives in has **already** called `resetRejectionCounter()`. A snapshot-churn rejection therefore performs the **increment only** — it must not re-run reset-then-increment (the green-rejection idiom used elsewhere where reset has not yet fired), which would double-reset and break the bound. Rules out: copying the reset-then-increment idiom into a branch that already reset.
- Seam throws / resolves false ⇒ blocker stands (exit 7, commit) as today. Rules out: validation infra errors swallowing a real blocker.
- Telemetry: rejection emits `kind: "blocker-rejected"` with a distinct `exitReason: "snapshot-churn"`, reusing the existing `blocker-rejected` telemetry kind (no new kind). It must not emit the `blocked` / `blocker-detected` event. Rules out: a new telemetry kind (the `blocker-rejected` kind already exists); conflating snapshot-churn with base-ref-green rejection or with a stood blocker.

## Task checklist

- [ ] Add the `runSnapshotUpdateRetest?: () => Promise<boolean>` seam to the run/iteration options.
- [ ] In `runIteration`, inside the base-ref-red branch (claim blocker, git on, bound not hit, base-ref ran without rejecting — **not** the shared commit + exit-7 block), invoke the seam when present. In that branch `resetRejectionCounter()` has already run.
- [ ] On seam green: strip `## Blocker`, emit `blocker-rejected` / `exitReason: "snapshot-churn"`, log, increment the shared rejection counter, continue (no exit 7, no commit).
- [ ] On seam red / absent / throws / bound hit: keep the current blocker-stands commit + exit 7 path (`blocked` event).
- [ ] Add tests in `v1/test/run.test.ts` alongside the base-ref blocker tests: green seam rejects + strips, red seam stands, absent seam stands (fail-safe), and the shared bound eventually lets a churn blocker stand.

## Acceptance criteria

- [ ] A claim blocker that base-ref validation did not reject triggers the snapshot-update re-test seam before exit 7; the seam resolving green rejects the blocker — the run continues, no exit 7, no blocker commit, and the `## Blocker` section is removed from the subspec.
- [ ] A snapshot-churn rejection emits a `blocker-rejected` telemetry event with `exitReason: "snapshot-churn"` and does not emit the `blocked` / `blocker-detected` event.
- [ ] The same claim blocker with the seam resolving red lets the blocker stand: the run exits 7 and commits the blocker, as today.
- [ ] With no seam provided (or when it throws), the blocker stands and the run exits 7 (fail-safe).
- [ ] After the shared per-subspec claim-rejection bound is reached, a further matching claim blocker stands (exit 7) instead of invoking the snapshot seam.
- [ ] The snapshot gate is not invoked for a blocker base-ref validation already rejected, nor for a non-claim blocker (existing base-ref and non-claim blocker tests in `v1/test/run.test.ts` stay green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — extend the blocker-claim validation entry: after base-ref validation declines to reject a claim blocker, a snapshot-update re-test gate runs in the agent worktree; re-test green strips the `## Blocker`, emits `blocker-rejected` / `exitReason: "snapshot-churn"`, and continues (leaving updated snapshots dirty for the normal commit); red / absent seam / throw exits 7; the gate shares the per-subspec claim-rejection bound with base-ref. Record the injected seam `runSnapshotUpdateRetest`.

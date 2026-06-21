# Verdict — Refinement Required

The spec's core architecture is sound: fail-safe default (blocker stands unless the base ref proves green), the 00/01 seam split, and "reject only on green base" are well-judged and should be preserved. The following refinements are required before the spec is ready.

## Must fix

1. **Cover or explicitly defer the red completion-verdict path.** The intent names two triggers — a `## Blocker` (exit 7) *and* a "red completion verdict" citing pre-existing failures. The spec addresses only the blocker path; the ready-gate stuck-red path is a separate mechanism and is neither covered nor deferred. Silence against stated intent is not acceptable. Either bring it in scope or add an explicit out-of-scope line in `index.md` deferring it to a follow-up intent, with a one-line rationale. (Deferral is the lighter option and keeps the two subspecs within the reviewability boundary.)

2. **Make the validation seam async.** Base-ref resolution and the test run are inherently asynchronous (await on ref resolution + worktree creation + test command). A synchronous `(baseRef) => boolean` seam in 00 cannot host 01's real implementation without 01 rewriting 00's contract, breaking clean composition. The seam must be async (`=> Promise<boolean>`) from the start in 00.

3. **Pin the base-ref worktree creation to a detached commit, not a branch checkout.** Creating a throwaway worktree *on the base branch* fails when that branch is already checked out in the primary worktree — the normal target-repo state, which breaks the happy path. 01 must resolve the base ref to a commit and create the worktree detached at that commit. Cleanup must also be guaranteed on error (the AC promises "no leftover worktree," so cleanup must run even when the test run throws).

4. **Bound repeated rejections.** The failure mode being defended against is transient churn; rejecting-and-continuing risks an unbounded loop (re-trip → re-raise → re-validate the full suite → re-reject) with an expensive base-ref suite each cycle on slow repos. The spec must specify a bound so a repeatedly-rejected claim blocker eventually stands, mirroring the existing no-progress machinery the harness already uses.

## Should fix

5. **Decide the base ref deliberately and record it.** The chosen resolution shells out to `gh` (network), so offline/`skipGhCheck` runs degrade to fail-safe, and the default-branch-as-it-is-now can differ from the branch's actual fork point. A local merge-base is offline, more accurately "the base the branch was created from," and pairs naturally with the detached-commit requirement (#3). The spec should make this an explicit decision rather than implicitly inheriting the documented helper; if it keeps the remote helper, it must note the offline-degrades-to-fail-safe behavior.

6. **Specify rejection telemetry.** Today's path emits a `blocked`/`blocker-detected` event; on reject that must not fire, but the spec records nothing positive. An operator needs a distinct rejection event to confirm the feature fired and to diagnose the oscillation bound (#4). Add a telemetry decision — legitimate here since this is a harness subspec where telemetry fields are part of the contract. (stderr logging is not telemetry.)

7. **Pin how `## Blocker` is stripped.** Stripping must honor the exact parser-enforced `## Blocker` heading and section boundaries (reuse the existing spec-parsing section logic) rather than ad-hoc text deletion, including when the section is last or carries trailing content.

## No action required

Classifier breadth (explicitly accepted trade-off, neutralized once #4 bounds repetition), hardcoded `bun run test` (intentional parity with the existing patch runner; non-bun targets fail-safe in the safe direction), and uncommitted mid-edit churn after reject (inherits existing loop semantics) need no change. ACs are observable/behavioral and the `v2/docs/v1-behaviors.md` update is correctly included.
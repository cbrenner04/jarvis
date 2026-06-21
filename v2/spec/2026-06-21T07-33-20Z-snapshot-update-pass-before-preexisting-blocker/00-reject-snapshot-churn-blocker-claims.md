# 00 — Reject blocker claims when an update-snapshots pass makes the suite green

## Problem

`runIteration` detects a `## Blocker` added during an iteration and, when the
body cites pre-existing / unrelated / baseline failures, validates the claim
against the base ref before exit 7 (`v1/src/modes/patch/iteration.ts:758-853`).
That gate rejects only on a **green base ref**. The observed false blockers were
outdated snapshots: the agent ran tests before finishing its snapshot updates, so
the working tree failed on stale snapshots. A red base ref (or a real-but-stale
snapshot) lets that churn blocker stand today.

This subspec adds a snapshot-churn gate that runs **before** base-ref validation:
update snapshots in the agent working tree, re-test, and reject the blocker if the
suite then passes. The update + re-test run is injected behind a seam here; its
production implementation lands in `01`.

## Decisions

- The snapshot-churn gate runs **before** the existing base-ref gate, on the same `detectBlockerClaim` match, and before the blocker is committed. Ordering matters: snapshot churn must be rejected even when the base ref is **red**, which base-ref validation lets stand — running the snapshot gate first is the only way to catch that case. Rules out: placing it after base-ref validation (a red base would already have stood the blocker, so the gate never runs on the case it exists for).
- The seam re-tests the **agent working tree** (agent edits + freshly updated snapshots), not the base ref. The signal is "does the agent's own tree pass once its unfinished snapshot updates are completed." Rules out: re-testing a throwaway base worktree (that is base-ref validation's job and answers a different question).
- Injected via an **async** seam (`opts.updateSnapshotsAndRetest?: () => Promise<boolean>`, true = re-test green after the update pass). Default when absent = **fail-safe: gate does not reject; fall through to base-ref validation unchanged**. Async so `01`'s real implementation (command resolution + update run + re-test, all awaited) drops in without changing this contract. Rules out: a sync seam `01` would have to break; making the gate reject when the seam is unimplemented (would weaken a real blocker on merge of this subspec alone).
- Reject = seam returns true (suite green after updating snapshots). On reject: strip the `## Blocker` section (reuse the same `stripBlockerSection` path the base-ref gate uses), emit a distinct rejection telemetry event, log to stderr, increment the rejection counter, and continue the iteration loop — no exit 7, no blocker commit. Rules out: leaving `## Blocker` in place (next iteration re-trips it); re-implementing strip logic.
- Reuse the existing per-subspec rejection bound and counter (`state.consecutiveBlockerClaimRejections` / `BLOCKER_CLAIM_REJECTION_BOUND`) shared with the base-ref gate, so a churn-reject → re-raise → re-reject loop is bounded and counts the same as a base-ref reject. Rules out: a second independent counter (two unbounded interacting loops); an unbounded snapshot gate re-running the suite each cycle on slow repos.
- Telemetry: a snapshot-churn rejection emits a distinct reason (e.g. `kind: "blocker-rejected"`, `exitReason: "snapshot-churn"`), distinguishable from the base-ref gate's `base-ref-green`, and does **not** emit the `blocked` / `blocker-detected` event. Rules out: reusing `base-ref-green` (operator can't tell which gate fired); silence (can't confirm the feature fired).
- Seam throwing or returning false → gate does not reject; control falls through to the existing base-ref gate, whose behavior is unchanged. Rules out: a seam error swallowing a real blocker or short-circuiting base-ref validation.
- **Accepted limitation — regression masking.** An update-snapshots pass blesses whatever the current output is, so a snapshot that fails because the agent *broke* the output goes green after the update exactly like a genuinely stale one; the gate then rejects the blocker and `01`'s WIP flow absorbs the now-wrong snapshot. Because this gate runs before base-ref validation and short-circuits it on reject, a snapshot-shaped regression also skips the base-ref check entirely — and unlike base-ref (which leaves the tree untouched) the snapshot gate rewrites files. Accepted: single operator, snapshots ride reviewable WIP commits, and the status-quo alternative (halting on stale snapshots) is the bug under repair. Rules out: silently shipping a gate that cannot distinguish stale from agent-broken output without the cost on record; consulting base-ref before accepting a churn reject (rejected here — heavier, and the accepted-risk rationale covers the single-operator case).
- The snapshot gate is **not** git-guarded: it mutates files → re-tests → strips the section → continues with no commit, so it needs no git and fires even in a non-git run. This diverges from the base-ref gate, which is `gitEnabled`-guarded. Rules out: copying the base-ref git guard onto a gate that does no git operations (would needlessly disable churn rejection in non-git runs).
- The reject path mirrors the base-ref reject's counter handling exactly: first set the subspec-path field (resetting `consecutiveBlockerClaimRejections` to 0 when the active subspec changed), **then** increment — never a bare increment. Rules out: incrementing without the path-tracked reset (stale counter carries across subspecs, mis-bounding unrelated claims).
- The reject/continue path mirrors the base-ref continue semantics: increment `state.iteration` before returning `continue`. Rules out: continuing without the iteration increment (off-by-one against the base-ref path, miscounted loop accounting).

## Task checklist

- [ ] In `runIteration`, on a `detectBlockerClaim` match and before base-ref validation, run `opts.updateSnapshotsAndRetest` when present and the per-subspec rejection bound is not yet hit.
- [ ] On a true result: strip the `## Blocker` section, emit the `snapshot-churn` rejection telemetry event, log rejection, set the subspec-path field then increment the shared rejection counter (reset-then-increment, mirroring the base-ref path), increment `state.iteration`, continue the loop (no exit 7, no blocker commit).
- [ ] Do not git-guard the snapshot gate: it fires regardless of `gitEnabled` (it does no git operations), unlike the base-ref gate.
- [ ] On false / absent seam / throw: fall through to the existing base-ref gate with no behavior change.
- [ ] Add the async seam to the run options type and default it to absent (fall-through) in `run.ts`.
- [ ] Add tests under `v1/test/run.test.ts` alongside the base-ref blocker tests: churn-green seam rejects (no exit 7, blocker stripped, `snapshot-churn` telemetry); false seam falls through to base-ref behavior; the shared rejection bound still stands a blocker after repeated rejections.

## Acceptance criteria

- [ ] A blocker body citing pre-existing/unrelated/baseline failures runs the update-snapshots + re-test seam before base-ref validation; a seam resolving green rejects the blocker — the run continues, no exit 7, no blocker commit, and the `## Blocker` section is removed from the subspec.
- [ ] A snapshot-churn rejection emits a distinct telemetry event (`exitReason: "snapshot-churn"`), separate from the base-ref gate's `base-ref-green`, and does not emit the `blocked` / `blocker-detected` event.
- [ ] When the update-snapshots seam resolves false (or is absent, or throws), control falls through to the existing base-ref validation and exit-7 path with no change to that behavior.
- [ ] A snapshot-churn rejection counts against the same per-subspec rejection bound as a base-ref rejection; after the bound is reached, a further matching claim blocker stands (exit 7) instead of re-running the gate.
- [ ] The snapshot gate fires in a non-git run (it is not `gitEnabled`-guarded); a churn-green seam rejects the blocker even when base-ref validation could not run.
- [ ] A blocker body with no pre-existing/unrelated/baseline language is not gated and exits 7 unchanged.
- [ ] The existing base-ref blocker tests in `v1/test/run.test.ts` stay green (base-ref behavior unchanged when the snapshot seam is absent).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that a patch-mode blocker citing pre-existing/unrelated/baseline failures first runs an update-snapshots + re-test pass on the agent working tree (before base-ref validation); a green re-test rejects the blocker (run continues, `## Blocker` stripped, no blocker commit, distinct `snapshot-churn` rejection telemetry), and a false/absent/throwing seam falls through to base-ref validation unchanged. Note the rejection bound is shared with the base-ref gate, the gate is not git-guarded (fires in non-git runs, rewriting snapshot files in place), and record the accepted regression-masking limitation: the gate cannot distinguish a stale snapshot from agent-broken output, and a churn reject short-circuits base-ref validation.

# A published lane settles honestly on fence-derivation failure

## Problem

`runPublisher` pushes the branch and opens the draft PR before ready finalization runs (`v2/src/execution/write-loop.ts:4413-4430`), so every fence-derivation failure in `publishWithReadyRepair` happens on a lane whose work is already published. Both sites still return `completion_commit_failed` (`:3554-3564`, `:4149-4156`), which `completionCommitFailed` (`:4460`) settles as resumable — and `run-operator-error.ts:258-261` then advertises `nextAction: "resume"`, although resume replays the same derivation against the same worktree and fails identically (fixed point, #3423, #4004).

## Decisions

- A fence-derivation failure with the branch pushed, the draft PR open, and no repair in flight — no persisted repair fence and no repair iteration consumed on the run — does not settle `completion_commit_failed`; it proceeds to the flip-to-ready path. Rules out failing a lane whose work already landed on the branch.
- The flip reuses the existing ready-finalizer flip path with the gate skipped, the same seam markdown-only lanes already use (`skipReadyGate`, `write-loop.ts:4319`); rules out a second bespoke flip implementation.
- A failure of that flip classifies as the existing `ready_flip_failed` (run stays `completed`, `nextAction: "stop"`); rules out re-entering `completion_commit_failed` through the back door.
- When the lane is not published — no PR evidence — the derivation failure still settles `completion_commit_failed`, but non-resumable, so `run-operator-error.ts` yields `nextAction: "stop"`. Rules out advertising a resume that replays the same derivation.

## Acceptance criteria

- [ ] A `write-loop.test.ts` test proves an `implement-review` completion whose review scope is empty reaches flip-to-ready rather than settling `completion_commit_failed`; it fails against the pre-fix settlement.
- [ ] A `write-loop.test.ts` test proves a lane with the branch pushed, the PR open, and all criteria ticked neither settles `completion_commit_failed` nor reports `nextAction: "resume"` on a fence-derivation failure. Both are reachable on the base today at `write-loop.ts:3554-3564` feeding `completionCommitFailed` at `:4460`, whose resumable settlement maps to `resume` at `run-operator-error.ts:258-261`.
- [ ] A `write-loop.test.ts` test proves `jarvis run resume` on such a row is not a fixed point: the row it produces is not the identical unresumable-derivation settlement.
- [ ] A test proves an unpublished lane's fence-derivation failure settles non-resumable and reports `nextAction: "stop"`; it fails against the pre-fix resumable settlement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — what a fence-derivation failure means, why the lane stays published, and why resume is not the recovery.
- `v2/docs/write-behavior.md` — honest settlement on fence-derivation failure: published lanes flip to ready, unpublished lanes settle non-resumable.
- `v2/docs/v1-behaviors.md` — record the changed settlement for fence-derivation failure.

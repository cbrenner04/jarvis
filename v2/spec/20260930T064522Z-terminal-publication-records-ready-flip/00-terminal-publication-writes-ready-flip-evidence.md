# Terminal publication writes ready-flip evidence after flip success

## Problem

Pipeline terminal publication (`executeTerminalPublication`, wired from `pipeline-execution.ts`) republication will refuse an open non-draft PR unless durable evidence shows this lane's harness flipped it ready earlier, but `runReadyFlipOrFail` never invokes ready-flip evidence persistence after a successful `gh pr ready`, so the entry run row cannot prove the harness flipped that PR. Standalone implement / `ready-finalize` flip sites are out of scope.

## Decisions

- Invoke `recordHarnessReadyFlipEvidence` inside `runReadyFlipOrFail` only after `deps.ghReadyFlip` resolves successfully for the pre-flip resolved PR number — rules out a `pipeline-execution` post-`execute()` write that cannot run between flip and merge on `terminalAction: "merge"`.
- Pass `prNumber`, `branch`, and `baseRef` from the publication input and the resolved flip target number respectively (`input.branch`, `input.baseRef`, `resolvedPrNumber`) — rules out persisting the stale `prNumber` handed into the call when re-resolution returns a different open draft.
- Wire persistence through an optional `recordHarnessReadyFlipEvidence` callback on `TerminalPublicationInput` (pipeline closes over `entryRun.id` and `StateStore`) — rules out importing `StateStore` into `terminal-publication.ts`.
- Omit the write when the callback is absent — rules out inventing a run row for seam-only unit tests that never model persistence.
- A rejected `ghReadyFlip` leaves prior row evidence unchanged and performs no write on this attempt — rules out recording on gate success before flip or on flip failure paths that still throw `TerminalPublicationError`.
- `ready-finalize` / standalone write-loop finalization stays out of scope — rules out coupling this subspec to non-`terminal-publication.ts` flip sites (separate follow-on intents).

## Tasks

- [ ] Extend `TerminalPublicationInput` with optional `recordHarnessReadyFlipEvidence`; after successful `ghReadyFlip` in `runReadyFlipOrFail`, invoke it with `{ prNumber: resolvedPrNumber, branch: input.branch, baseRef: input.baseRef }`.
- [ ] Bind the callback from `resolveTerminalPublicationInput` in `pipeline-execution.ts` to `store.recordHarnessReadyFlipEvidence` for `entryRun.id`.
- [ ] Add `terminal-publication.test.ts` coverage using an in-memory `StateStore`: successful `ready` (and merge if it shares the flip helper) persists evidence on the run row; rejecting `ghReadyFlip` performs no write and leaves pre-existing row evidence unchanged.
- [ ] Add `pipeline-execution.test.ts` (or focused) coverage that `resolveTerminalPublicationInput` supplies the callback closed over `entryRun.id` and `store.recordHarnessReadyFlipEvidence`.
- [ ] Update `v2/docs/v1-behaviors.md` and `v2/docs/state-store.md` per Documentation updates.

## Acceptance criteria

- [ ] `terminal-publication.test.ts` fails against the pre-fix path and pins evidence persistence on the run row after a successful flip.
- [ ] `terminal-publication.test.ts` fails against the pre-fix path and pins unchanged prior ready-flip evidence on the run row when injected `ghReadyFlip` rejects.
- [ ] `pipeline-execution.test.ts` fails against the pre-fix path and pins `resolveTerminalPublicationInput` supplying `recordHarnessReadyFlipEvidence` closed over `entryRun.id` and `StateStore.recordHarnessReadyFlipEvidence`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — pipeline terminal publication after a successful harness ready flip persists ready-flip evidence on the owning run row.
- [ ] `v2/docs/state-store.md` — production writers include pipeline terminal publication via `recordHarnessReadyFlipEvidence` bound from `resolveTerminalPublicationInput`; qualify or remove wording that terminal settlement never writes `harness_ready_flip_evidence` where it would contradict this path.

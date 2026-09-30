# Republication undoes a harness-ready flip before reusing the PR

## Problem

`resolveOpenDraftPr` (`v2/src/execution/completion-publisher.ts`) throws `OpenPrNotDraftError` on the sole matching open PR when `isDraft` is false. After the harness flips that PR ready, lane re-publication forces manual `gh pr ready --undo` even though the non-draft state came from the harness.

## Decisions

- Before throwing on a sole open non-draft match, consult `findNewestHarnessReadyFlipEvidenceInLineage` for `(project, spec_ref, branch, baseRef, prNumber)` on the publication target — rules out undo without lineage proof and rules out skipping the lookup when the PR is non-draft.
- Lineage `baseRef` and open-PR list filtering use the same base ref for that publication attempt — when completion publication retargets base (`effectiveBaseRef` ≠ requested), both keys use `effectiveBaseRef` — rules out matching evidence recorded under requested base while listing under resolved base (false negatives on retarget).
- Matching lineage evidence for the open PR number and publication branch/base runs `gh pr ready --undo <number>` once, then confirms and reuses that PR like an open draft — rules out leaving the PR ready through publication and rules out creating a second PR.
- No lineage hit, evidence for a different PR number, or a triple mismatch on branch/baseRef keeps `OpenPrNotDraftError` and the existing message with no `--undo` — rules out undoing operator-flipped or foreign PRs.
- `--undo` failure surfaces as a permanent publication failure with `operation: "gh pr ready --undo"` and the PR number, outside the `"pr"` retry loop — rules out transient retry on undo and rules out satisfying undo failure via retried `findOrCreatePr`.
- Ambiguous open PR and no-publishable-commits paths stay unchanged — rules out widening refusal surfaces in this slice.
- Republication undo applies on completion publication (`resolveOpenDraftPr` during `createCompletionPublisher` / `publishCompletionArtifacts`) only — pipeline terminal publication that re-resolves a still-ready PR without an intervening completion republication keeps `OpenPrNotDraftError` and runbook manual recovery — rules out promising undo in `terminal-publication.ts` without wiring tasks here.
- Lineage lookup is optional on `resolveOpenDraftPr` / completion publisher input; production binds `findNewestHarnessReadyFlipEvidenceInLineage` from the run row that owns the active publication (`write-loop` iteration row, repair/resume republication, and push-only `publishCompletionArtifacts` on `context.runId`) — rules out hard-coding store access inside the resolver, unwired default publishers, and consulting a sibling row (null evidence → silent refusal).

## Task checklist

- [ ] Extend `resolveOpenDraftPr` (and `createCompletionPublisher` / `CompletionPublisherInput` as needed) with an injectable lineage-evidence seam keyed to publication `branch`, effective `baseRef`, and the sole open PR number.
- [ ] On sole open non-draft with matching evidence, invoke `gh pr ready --undo <number>` once (no `runPublicationWithRetry` `"pr"` loop), then `confirmPr` and continue the existing publication sequence.
- [ ] Wire the seam from `publishCompletionArtifacts` / `runPublisher` through write-loop republication, repair/resume republication, and push-only publication using `project`, `spec_ref`, and `findNewestHarnessReadyFlipEvidenceInLineage` on the owning run row's store.
- [ ] Add regression tests in `completion-publisher.test.ts` for match, no evidence, wrong PR number, branch/base mismatch, and failing `--undo`.
- [ ] Add a `write-loop.test.ts` test that drives default completion publication (real `createCompletionPublisher`, not a stub) with matching lineage on the active run row and asserts `gh pr ready --undo` on a sole open non-draft PR; fails against pre-fix unwired production binding.
- [ ] Update operator and write-behavior docs and record the behavior change in `v1-behaviors.md`.

## Acceptance criteria

- [ ] A new test in `completion-publisher.test.ts` fails against the pre-fix resolver and, with a fake `gh` reporting one open non-draft PR #N for the publication branch and base and matching lane evidence for that triple, asserts `gh pr ready --undo N`, reuse of #N, and no throw.
- [ ] The same fake with no recorded flip evidence throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] Evidence recording a flip of #M while #N is open throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] Evidence for #N on a different branch or base ref than the publication target throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] A failing `--undo` yields a permanent publication failure whose `operation` is `gh pr ready --undo` and whose `prNumber` is #N (not a retried `"pr"` step outcome).
- [ ] A test in `v2/src/execution/write-loop.test.ts` drives `publishCompletionArtifacts` with the default completion publisher, lineage evidence on the active run row's store, and a fake `gh` reporting one open non-draft PR #N for the publication branch and base; it asserts `gh pr ready --undo N` and successful publication, and fails against pre-fix production wiring.
- [ ] `refuses to reuse a matching open PR that is not a draft`, `refuses when the branch carries more than one open PR matching the same base`, and `surfaces a named error when gh pr create finds no publishable commits` (`v2/src/execution/completion-publisher.test.ts`) stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — drop manual `gh pr ready --undo` recovery for harness-flipped PRs on completion republication; keep it for operator-flipped or legitimately ready PRs and for pipeline terminal publication when no completion republication ran.
- `v2/docs/write-behavior.md` — document automatic re-draft of harness-flipped PRs on completion republication before reuse.
- `v2/docs/v1-behaviors.md` — record the changed republication behavior.

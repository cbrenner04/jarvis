# Tighten retired-worktree artifact resolution

## Problem

`sourceForRun` accepts a run's repository-contained `.jarvis-*` staging identity as a durable spec path, and `artifactForRetiredWorktree`'s `?? sources[0]` fallback then admits it even though it was never proven to be a spec tree. The only externally observable defect is a false dry-run preview line (`previewArtifact` prints unconditionally, with no existence check) naming a nonexistent harness staging path as an archive candidate. Apply is already safe: `checkArtifactEligibility`'s completeness check (`completedSpecEligibility`) refuses any source missing from disk or missing `index.md`, so apply cannot move or create a stray destination for this input — it just skips with "could not inspect spec completeness."

## Decisions

- Reject a run identity containing a `.jarvis-*` path segment via `isJarvisHarnessSidecarPath` (the any-segment predicate — distinct from `isHarnessWorkflowStagingPath`'s named-directory list, which does not match a repository-contained intent-stage identity); apply the check to `identity` in `sourceForRun`, i.e. after relativizing an absolute `specPath` against the worktree path, so an absolute staging path under the worktree is caught the same as a relative one. Rules out treating repository-contained harness output as a durable spec.
- `sourceForRun` is shared by `artifactForRetiredWorktree`, `recordedStrandedBranch`, and `detachedWorktreeOwnsArtifact`; the filter lands there rather than only at the retired-worktree resolver, matching the intent's stated surface. This is safe for the other two call sites because a `.jarvis-*` identity never resolves to a real stranded-artifact or ownership path today — a preservation criterion below pins this.
- Accept only a directory containing `index.md` or a Markdown spec file as `artifactForRetiredWorktree`'s source; rules out the `?? sources[0]` fallback admitting an arbitrary or missing directory.
- No change to how the archive home is derived (`dirname(source)`) or to external `plans/` routing: once a source is proven and harness staging is excluded, `dirname(source)` is already the correct spec home — the bug's wrong-home symptom only ever arose from admitting an unproven `.jarvis-*` source in the first place.
- Recheck the resolved source exists immediately before `previewWorktreeCandidates` calls `previewArtifact`; rules out the false preview line for a candidate no longer on disk. No apply-side change: `checkArtifactEligibility` already refuses a missing source.
- Deferred to first consumer: producer-side `specPath` correctness (why an intent write step records its staging directory as `run.specPath`) — pin when a caller needs it.

## Task checklist

- [ ] Filter `.jarvis-*` identities and require a proven spec source in `sourceForRun` / `artifactForRetiredWorktree`.
- [ ] Guard `previewWorktreeCandidates` against a vanished resolved source before calling `previewArtifact`.
- [ ] Add focused regression coverage and update durable cleanup documentation.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` proves a run whose `specPath` — relative, or absolute and resolving under the worktree — contains a `.jarvis-*` segment after relativization yields no source from `sourceForRun`; it fails against the current containment-guard-only filter.
- [x] `v2/src/commands/cleanup.test.ts` proves `artifactForRetiredWorktree` returns no candidate when no source contains `index.md` and none is a Markdown spec file; it fails against the current `?? sources[0]` fallback.
- [x] `v2/src/commands/cleanup.test.ts` proves `previewWorktreeCandidates` prints no archive preview line for a retired-worktree candidate whose resolved source is absent from disk immediately before preview; it fails against the current unguarded `previewArtifact` call.
- [x] `v2/src/commands/cleanup.test.ts` tests "retires before archiving a complete durable spec and prunes only its consumed intent", "archives open-home spec when retiring its owning worktree in one invocation", "resolves absolute external plan specPath from durable implement run for retired-worktree archival", and "archives eligible external plan after completeness and ownership checks" stay green (destinations unchanged).
- [x] `v2/src/commands/cleanup.test.ts` tests "recordedStrandedBranch matches external plan directory from chained implement specPath" and "keys stranded ownership to the recorded project branch and rechecks it before archival" stay green (the `.jarvis-*` filter in `sourceForRun` does not affect stranded-branch or ownership resolution).
- [x] `v2/docs/operator-runbook.md` states that post-retirement resolution ignores every `.jarvis-*` identity and accepts only an extant, proven spec source; archive destinations are unchanged.
- [x] `v2/docs/v1-behaviors.md` records the tightened retired-worktree source proof (harness-staging rejection, proven-source requirement, pre-preview existence recheck).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — extend the cleanup contract: post-retirement resolution rejects `.jarvis-*` identities and requires a proven, extant spec source before offering archival.
- `v2/docs/v1-behaviors.md` — record the changed retired-worktree artifact resolution (harness-staging rejection, proven-source requirement, pre-preview existence recheck; destinations unchanged).

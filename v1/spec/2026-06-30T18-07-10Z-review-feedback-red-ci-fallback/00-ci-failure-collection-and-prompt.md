# 00 - Shared CI failure collection and prompt

## Problem

`review-feedback` needs failing-check names and bounded log excerpts when the PR has red CI but no
open review comments. Triage `--merge` already classifies commit check-runs green/pending/red;
that logic must be reusable without a parallel CI vocabulary or full workflow-log ingestion.

## Decisions

- Extract `classifyCiChecks`, `adaptCheckRunsToCiStates`, and HEAD-sha commit check-run fetch from
  `v1/src/commands/triage.ts` into a shared module (`v1/src/ci-checks.ts`) — rules out
  review-feedback importing `triage.ts` or duplicating classification tables.
- `triage --merge` and flake-recovery paths import the shared module unchanged in behavior — rules
  out triage regressions while landing shared helpers.
- Check source for collection: paginated `gh api repos/{owner}/{repo}/commits/{sha}/check-runs`
  at worktree `HEAD` (`git rev-parse HEAD`), owner/repo from worktree `origin` via existing
  `normalizeRepoUrl` — rules out branch-scoped `gh pr checks` for the no-comments CI branch.
- Classification reuses triage `--merge` green/pending/red mapping on adapted `CiCheckState[]`
  (including fail-closed null/empty → red) — rules out a review-feedback-specific CI taxonomy.
- `collectFailingCiContext` returns every red-classified check name (not only
  `classifyCiChecks`'s first `failingCheck`) — rules out hiding multi-check failures behind one
  name.
- Excerpt source: check-run `output.summary` and `output.text` from the same check-runs API
  response when present — rules out separate workflow-run / job-log fetches in v1.
- Per-check excerpt cap: 2048 bytes combined (`summary` + `text`), tail-preserved when truncated;
  missing output → literal `(no excerpt available)` for that check — rules out ingesting full CI
  logs.
- `renderCiFailurePrompt` mirrors `renderReviewPrompt` structure: branch/PR header, CI-fix
  instructions (one pass, no agent commit/push), failing checks with excerpts, then patch rules —
  rules out embedding CI excerpts inside the comment prompt renderer.
- gh fetch and prompt rendering are injectable/testable without live network — rules out
  network-dependent unit tests.

## Task checklist

- Add `v1/src/ci-checks.ts` with extracted classification, adapter, HEAD-sha fetch, and exported
  `CiCheckState` type; update `triage.ts` imports (preserve existing exports/tests).
- Add `collectFailingCiContext` and `renderCiFailurePrompt` (new module or colocated in
  `v1/src/review-feedback.ts` if that keeps the prompt beside comment collection).
- Tests: adapter/classification preservation (`triage-command.test.ts` cases stay green);
  collection returns all red checks with capped excerpts; prompt includes check names, excerpts,
  and patch rules; truncation and `(no excerpt available)` paths.

## Acceptance criteria

- [ ] `adaptCheckRunsToCiStates` and `classifyCiChecks` behavior is unchanged — `triage-command.test.ts` adapter/classification and `--merge` CI cases stay green after extraction.
- [ ] `collectFailingCiContext` at a red HEAD returns every red-classified check name with a per-check excerpt capped at 2048 bytes (tail-preserved) or `(no excerpt available)` when output is absent.
- [ ] `renderCiFailurePrompt` emits a CI-focused agent prompt listing each failing check and its excerpt and ends with patch mode rules; no review-comment sections appear.

## Documentation updates

None — operator-visible `review-feedback` behavior lands in subspec 01.

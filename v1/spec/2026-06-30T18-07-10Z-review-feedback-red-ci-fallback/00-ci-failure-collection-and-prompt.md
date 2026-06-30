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
- Check source: paginated `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` at worktree
  `HEAD` (`git rev-parse HEAD`), owner/repo from worktree `origin` via existing `normalizeRepoUrl`
  — rules out branch-scoped `gh pr checks` for the no-comments CI branch.
- Shared HEAD-sha fetch returns a discriminated result: `{ ok: true, checkRuns }` on success;
  `{ ok: false, reason }` on gh API error, unresolvable `origin`, JSON/parse failure, or pagination
  abort — rules out returning `null` that `classifyCiChecks` would treat as synthetic red
  (`"no checks found"`).
- `classifyCiChecks` on `CiCheckState[] | null` keeps triage fail-closed null/empty → red — rules
  out changing triage `--merge` / flake-recovery classification semantics.
- Classification reuses triage `--merge` green/pending/red mapping on adapted `CiCheckState[]`
  — rules out a review-feedback-specific CI taxonomy.
- `collectFailingCiContext` operates on an already-fetched `{ ok: true, checkRuns }` payload (no
  second gh call) and returns every red-classified check name — rules out hiding multi-check
  failures behind `classifyCiChecks`'s first `failingCheck`.
- Excerpt assembly: concatenate `output.summary` then `output.text` (newline when both present);
  apply the 2048-byte cap to the combined string with tail preservation — rules out separate caps
  per field or alternate field order.
- Missing `output` fields → literal `(no excerpt available)` for that check — rules out ingesting
  full CI logs or separate workflow-run / job-log fetches in v1.
- Shared fetch keeps `execSync` for triage parity — rules out silent migration to `runGhCommand`
  during extraction.
- `renderCiFailurePrompt` mirrors `renderReviewPrompt` structure: branch/PR header, CI-fix
  instructions (one pass, no agent commit/push), failing checks with excerpts, then patch rules —
  rules out embedding CI excerpts inside the comment prompt renderer.
- gh fetch and prompt rendering are injectable/testable without live network — rules out
  network-dependent unit tests.
- Deferred to first consumer: status-only CI failures (commit statuses invisible to check-runs
  fetch) — pin when a caller needs broader CI coverage.

## Task checklist

- Add `v1/src/ci-checks.ts`: extract and extend classification, adapter, and HEAD-sha fetch
  (check-run records carry `name`/`status`/`conclusion` for classification plus optional
  `output.summary` / `output.text` for excerpts); export symbols needed by consumers (`CiCheckState`,
  `adaptCheckRunsToCiStates`, `classifyCiChecks`, fetch result type + fetch function); doc-comment
  every exported symbol per `v2/docs/documentation-standard.md`; update `triage.ts` imports.
- Add `collectFailingCiContext` and `renderCiFailurePrompt` (new module or colocated in
  `v1/src/review-feedback.ts` if that keeps the prompt beside comment collection).
- Tests: `triage-command.test.ts` adapter/classification and `--merge` CI cases stay green;
  fetch error result does not classify as red; collection returns all red checks with capped
  excerpts (concat order, tail truncation, `(no excerpt available)`); prompt includes check
  names, excerpts, and patch rules.

## Acceptance criteria

- [ ] `triage-command.test.ts` adapter/classification and `--merge` CI cases stay green after extraction.
- [ ] HEAD-sha fetch returns `{ ok: false }` on gh API error, unresolvable `origin`, JSON/parse failure, or pagination abort — not `null` consumed as classifiable empty input.
- [ ] `collectFailingCiContext` on red-classified check data returns every red check name with excerpt = `summary` + newline + `text` (when both present), capped at 2048 bytes tail-preserved on the combined string, or `(no excerpt available)` when output is absent.
- [ ] `renderCiFailurePrompt` emits a CI-focused agent prompt listing each failing check and its excerpt and ends with patch mode rules; no review-comment sections appear.

## Documentation updates

None — operator-visible `review-feedback` behavior lands in subspec 01.

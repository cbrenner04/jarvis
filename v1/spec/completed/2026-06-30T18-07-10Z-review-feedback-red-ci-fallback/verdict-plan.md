## Verdict — required refinements

### Subspec 00 — shared CI collection

1. **Separate fetch errors from classifiable check data.** Today `fetchCommitChecksForSha` returns `null` on API/parse failure and unresolvable `origin`; `classifyCiChecks(null)` fail-closes to `red` / `"no checks found"`. Subspec 00 must define a fetch result that surfaces hard failures before classification, and subspec 01 must require exit `1` on those failures — not a CI agent loop on synthetic failure.

2. **Pin empty successful check-runs on the no-comments branch.** A paginated fetch that succeeds with zero check-runs is not the same as API failure or a known failing check. Intent targets “red CI checks”; leaving empty unpin allows agent spawn, success exit, or error exit to drift. Record one explicit outcome (advocate’s options: same `no open review comments` success exit as green/pending, exit `1` as misconfiguration, or fail-closed agent loop).

3. **Single fetch for classify + collect.** No-comments path must not classify then refetch the same HEAD-sha check-runs API. One fetch feeds both classification input and excerpt payload.

4. **Pin excerpt assembly.** Concatenate `output.summary` then `output.text` (newline when both present); apply the 2048-byte cap to the combined string with tail preservation.

5. **Pin gh invocation style on extraction.** Triage flake-recovery uses `execSync`; review-feedback comment collection uses retried `runGhCommand`. State whether shared fetch keeps `execSync` for triage parity or migrates to `runGhCommand` (behavior change). Default reasonable: keep `execSync` unless migration is an explicit decision.

6. **Task checklist: extend + extract, not pure move.** Fetch must carry optional `output.summary` / `output.text` for excerpts while classification still reads `name`/`status`/`conclusion` only.

7. **Task checklist: export wording + inline doc-comments.** `classifyCiChecks` is private today — task should say “export symbols needed by consumers,” not “preserve existing exports.” Add doc-comment task per `v2/docs/documentation-standard.md`.

8. **Optional deferral (non-blocking).** `Deferred to first consumer: status-only CI failures` — commit-status-only reds invisible to check-runs fetch; acceptable v1 bound if acknowledged.

### Subspec 01 — `review-feedback` CI fallback

9. **Narrow AC 4 failure modes.** Drop “classification fails” — `classifyCiChecks` is total. Restrict to named failures: gh API error, unresolvable `origin`, JSON/parse failure, pagination abort. Align AC text with the fetch result shape from refinement 1.

10. **Add injectable CI hooks to `ReviewCommandOptions`.** Parallel to `collectReviewFeedbackFn`; command tests must not depend on live `gh`. Task checklist + AC.

11. **Pin CI-path no-op semantics.** Comment path exits `1` when agent makes no edits (`agent run completed with no file changes`). CI fallback inherits the same post-agent gate — add AC or explicit “shared post-agent gate unchanged” decision.

12. **Pin CI stdout contract.** Collection summary before `review prompt prepared` needs a concrete line format (mirror comment mode’s `collected N … for PR #<n>` pattern). Pin success tail: reuse `committed and pushed review feedback updates via <agent>` or CI-specific wording.

13. **Clarify AC 3 “stdout exactly”.** Current behavior writes the message plus trailing `\n`. “Exactly” should mean line body matches; trailing newline follows existing convention.

14. **Strengthen preservation AC 5.** Replace paraphrase (`no-comments-without-CI`) with cited test names from `review-feedback-command.test.ts` (e.g. `"no actionable comments exits 0 with no-open-comments message"`) plus other named preservation cases.

### Documentation (`v2/docs/v1-behaviors.md`, subspec 01)

15. **Note HEAD-sha vs branch-scoped divergence.** `review-feedback` uses HEAD commit check-runs; `triage --merge` polls branch-scoped `gh pr checks`. Shared classifier vocabulary does not guarantee cross-command alignment — document source and possible outcome difference.

16. **Runbook / `workflows.md` staleness — out of scope for this spec.** Subspec 01’s `v1-behaviors.md` update is correct per intent and spec guidance. Operator-runbook refresh belongs to the separate ready-intent; not a blocker here.

### Rationale (why these matter)

- Refinements 1–2 close a spec/code contradiction: AC 4 promises exit `1` on fetch failure, but today’s shared path would spawn an agent on `"no checks found"`.
- Refinements 9–14 align with spec guidance: behavioral ACs for new paths, test-anchored preservation ACs, injectable command options matching existing `review-feedback` test patterns.
- Refinement 15 prevents operators assuming `review-feedback` CI state matches `triage --merge` polling.

### No further refinement required

Intent decisions (extend `review-feedback`, comment priority, shared classification, bounded excerpts, pending → success exit, CI commit subject). Subspec split (00 infra, 01 wiring + docs). Thin excerpts and pending/green indistinguishability are accepted v1 bounds.

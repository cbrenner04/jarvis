Reviewing the cited docs and implementation to issue a verdict.
## Verdict

**Required: align operator docs with listing-before-claim behavior.**

1. **`v2/docs/operator-runbook.md` (§ Pipeline resume)** — Drop or narrow the closing sentence “Omitting the branch key keeps whole-pipeline resume unchanged.” It contradicts the new paragraph: on fan-out with resumable failed `plan` lanes, omitting the branch key now refuses with `branch_resume_required`, not unchanged whole-pipeline resume. Scope that line to cases with no such lanes (or remove it; the preceding sentence already covers that).

2. **`v2/docs/pipeline-execution.md` (§ Operator recovery, unscoped table)** — **Admitted** `resumed` and **No-effect claim** still describe unconditional `awaiting-approval` → claim. Code lists first (`listBranchResumeRequiredKeys` under `resumeAwaitingClaimsOnly`); claim/`missing_context`/`claim_refused` apply only when no listable failed-`plan` branches. Qualify those rows to match the updated **Refused** row and `pipeline-execution.ts`.

**No code or test changes required.** Implementation, wire shape, CLI formatting, and exercised fixtures match `00-unscoped-resume-lists-fanout-failed-plan-lanes.md`. Listing is gated to aggregate `awaiting-approval`; failed-`plan`-only scope; pending-strand and running paths unchanged.

**No action on:** stale `intent.md` checkboxes (delivery tracked in `00-…md`); optional precedence/pending-isolation tests; loose `branchKeys` typing; CLI tolerance for malformed envelopes; exotic failed-approval-before-failed-plan suffix (low likelihood, spec composite predicate met).
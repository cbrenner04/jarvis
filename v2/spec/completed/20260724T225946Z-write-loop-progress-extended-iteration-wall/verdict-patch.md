Verifying implementation against the spec and advocate claims before issuing the verdict.
## Verdict — required outcomes

1. **Resume must enforce the hard ceiling when the snapshot omits `iterationCeilingMs`.**  
   Subspec `01` requires that resume/revise not drop the ceiling while only carrying the wall segment. Today `reconstructWriteResume` forwards `iterationCeilingMs` only when the step already has it, so runs snapshotted before this change (or any step missing the field) get a progress-extended wall with **no** ceiling and chatty agents can exceed the intended 30‑minute cap. After fix: any admitted write resume supplies a resolved ceiling equivalent to fresh write-path dispatch (machine default when the key is absent), without weakening persistence when the snapshot already stores both bounds.

2. **Regression test for the resume ceiling gap.**  
   Cover daemon write resume (or the same reconstruction path) where the snapshot step has `iterationTimeoutMs` but no `iterationCeilingMs`, and assert the loop still enforces the configured/default ceiling (e.g. `iteration_timeout` under continuous progress near the ceiling, or that the loop input includes the resolved ceiling). This guards the operator-facing hole the workflow snapshot test does not touch.

3. **Align `v2/docs/write-behavior.md` with install-and-config / v1-behaviors on when the ceiling applies.**  
   The doc currently implies the ceiling exists only “when configured,” while the write path always resolves `iterationCeilingMs` (default `1_800_000` ms). Operators should read that normal `jarvis write` and workflow write steps always run under wall + ceiling after config resolution, and that optional `iterationCeilingMs` on `WriteLoopInput` is for direct/test injection—not the absence of a cap in production.

4. **Clarify in `v2/docs/install-and-config.md` that `idleOutputTimeoutMs` is validated on the write path but not yet armed on write invocations** (idle watchdog is a separate follow-on).  
   The bounds table already documents ordering; one explicit sentence avoids implying idle kills are live on write today.

5. **Tick subspec `01` **Tasks** checkboxes** to match the closed index and shipped work (readers, `resolveWritePathIterationBounds`, propagation, tests, docs).  
   Leaving tasks open while acceptance criteria and the index are checked is misleading ledger state.

**Rationale (not actionable):** Items 1–2 close a real compat/semantics gap against subspec `01` decisions and operator expectations. Items 3–4 fix durable-doc contradictions called out in the spec’s documentation sections. Item 5 is bookkeeping only.

**Not required for this patch:** daemon-side re-validation of bounds (explicitly out of scope in subspec `01`); end-to-end stdout→`onOutputProgress`→wall-reset integration test (subspec `00` AC satisfied via the progress hook seam); extending the iteration watchdog to post-`executeWrite` work such as coverage advisory (same scope as the pre-change flat timer); consolidating duplicate `DEFAULT_ITERATION_TIMEOUT_MS` constants; aligning `intent.md` acceptance checkboxes unless the harness routinely treats that file as binding.
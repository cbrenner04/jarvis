Verifying key codebase claims before issuing the verdict.
## Verdict

The spec’s core fix—passing full bullet-block text into resolution/linking while selection already does—is sound and appropriately scoped. Refine before merge on the items below.

### Required refinements

1. **Reconcile `v2/docs/write-behavior.md`**
   - Add `write-behavior.md` § `spec.criteria-ticked` to Documentation updates and a doc acceptance criterion.
   - That section describes mutation-checkpoint selection and verification but does not state that pinning-test resolution and directive linking read the full bullet block. After this fix, operators who read only `write-behavior.md` could still assume first-line semantics.
   - Prior mutation-checkpoint trust work updated operator-facing docs when verifier semantics changed; this change warrants the same treatment.

2. **Extend `v1/docs/spec-guidance.md` doc coverage for wrapping**
   - The enclosing-test regression (AC #2) requires authors to know that enclosing-test names on continuation lines are valid.
   - The current doc AC and Documentation updates bullet only say pinning-test references may wrap. Extend both to cover enclosing-test name wrapping on continuation lines, matching the operator-runbook coverage.

3. **Pin the mutation-checkpoint `@mutate` contract (AC #4)**
   - The checkpoint AC describes reverting the `resolveLinkedDirectives` argument without quoting the exact post-fix source line. `@mutate` requires a uniquely occurring original string; an unpinned description invites implementer guesswork and brittle pins.
   - Require either an exact quoted original→replacement pair in the AC (per trust-cluster convention) or an explicit task step to author the directive from the landed one-line call after the fix.

4. **Soften continuation-line indent wording**
   - AC #1’s “6-space continuation line” implies indent width is part of the verifier contract. Continuations are trimmed; existing verifier tests use different indent widths.
   - Reframe as a newline-joined wrapped bullet with the pinning reference or enclosing-test name on a continuation line, without prescribing indent width.

5. **Restore accurate prerequisites on the implement-facing subspec**
   - `intent.md` lists prerequisites; the subspec omits them. Implement agents see only the subspec.
   - Copy prerequisites into the subspec with corrected naming: block-aware text comes from local `acceptanceCriterionBlocks()` in `mutation-checkpoint-verifier.ts`, aligned with `parseSpec().acceptanceCriteria` indices and first-line `criterion.text`—not from a `parseAcceptanceCriteria` export named `acceptanceCriterionBlocks`.

6. **Clarify report-field vs resolution inputs (Decisions)**
   - Add a brief decision that report/diagnostic `criterionText` fields stay first-line (`criterion.text`) for readability; only resolution and linking inputs use the full block.
   - Prevents accidental full-block dumps in stderr during implementation without adding new acceptance criteria.

### Not required

- **Index-alignment regression** with interleaved unchecked/human-only rows — the filter-time `{ criterion, block }` decision is explicit; optional hardening only.
- **Full existing-test audit** — single call-site change; preservation is covered by “stays green.”
- **Second `@mutate` for enclosing-test linking** — both regressions share one guard; one checkpoint AC is sufficient.
- **`###` heading-boundary desync** — pre-existing parser edge case; out of scope.
- **Subspec split** — one module boundary, appropriately atomic.

### Rationale summary

Refinements close documentation gaps that would mislead operators and spec authors, make the mutation-checkpoint AC mechanically satisfiable, align test prose with actual verifier behavior, and give implement agents accurate prerequisite context. None of these change the implementation approach; they make the spec merge-ready.
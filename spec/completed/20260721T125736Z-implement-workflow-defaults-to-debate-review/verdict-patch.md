## Verdict

Implementation satisfies the runtime acceptance criteria: omitted `reviewPasses` resolves to one `review-debate` step on both the `projectRoot` early-return path and the registered-project path; explicit `0` still opts out; config-loader absent-field default is `1`; tests and code changes align with spec decisions. Two documentation gaps remain against the explicit documentation AC.

### Required outcomes

1. **`v2/docs/v1-behaviors.md` overview must distinguish implement from intent/plan.**  
   The "v2 workflow CLI names" overview still states uniformly that zero passes omit review for `intent`, `plan`, and `implement`. That is false for implement (omitted flag → one debate pass). The detailed implement entry (line ~280) is already correct. The overview must state that implement defaults to one debate pass when `--review-passes` is omitted, while intent/plan still omit review when omitted or zero, and must document `--review-passes 0` as the implement opt-out.  
   **Why:** Documentation AC requires every listed doc to reflect review-on-by-default and the opt-out; a contradictory overview violates operator-facing truth the spec explicitly scoped.

2. **`v2/docs/install-and-config.md` must document `--review-passes 0` opt-out.**  
   The `implement.reviewPasses` table correctly shows absent-field default `1`, but the follow-up paragraph only describes CLI override without stating that `0` skips review.  
   **Why:** Same documentation AC — each enumerated doc must document both the omitted-flag default and `--review-passes 0` opt-out.

### Not required

- **`workflow-runner.test.ts` updates:** No fixtures encoded implicit zero as the omitted-flag default; checklist item is satisfied by absence of such fixtures.
- **Registered-path test depth (`maxCycles`, `verdictPath`, etc.):** AC is met (step count + `review-debate` behavior); production launch resolution and review-step construction share the builder path already exercised by `"omitted reviewPasses defaults to one debate review step"`.
- **`configPath` omitted / `projectRoot` early-return config bypass:** Pre-existing programmatic seams; production CLI uses the registered path covered by tests. No regression introduced by this patch.
- **CLI e2e or snapshot pinning for two-step implement workflows:** Explicitly out of scope per spec; builder tests are the contract seam.

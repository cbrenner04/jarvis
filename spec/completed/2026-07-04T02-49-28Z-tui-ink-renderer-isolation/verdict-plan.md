Verdict: refine.

**1. No AC verifies the actual runtime fix.** The intent's stated goal is that `jarvis tui` and related entry points stop hitting `Cannot access 'Yoga' before initialization` on Linux/Bun. Every current AC is structural (single import site, test exists, `bun test` passes). Structural consolidation does not by itself prove the TDZ error is resolved — `loadInkUi`'s internal ordering could still be broken. The spec must add either an AC that exercises the failure mode directly (invoking a production entry path under the real runtime and asserting no TDZ error) or an explicit, stated reason why the structural ACs are a sufficient proxy for the runtime fix.

**2. Missing causal mechanism.** The spec doesn't state why routing `tui-field-collector` through `loadInkUi` addresses the TDZ error (e.g., single/ordered yoga-layout initialization). Name this mechanism as a Decision — it is the basis for #1's runtime AC and for readers to judge whether the fix is credible, not just tidy.

**3. `loadInkUi`'s exported surface is assumed, not decided.** AC1 requires `loadInkUi` to hand back a render function, `Text`, and `useInput`. If the boundary currently only returns a render function for the three already-migrated surfaces, this AC is silently expanding its API. Add a Decision stating the boundary's current vs. required exported surface.

**4. AC3's "without loading production ink" needs a concrete check.** As written this is unverifiable. State the mechanism (e.g., spy/mock on the `loadInkUi` import path, or a module-registry assertion) in the AC or a Decision.

**5. Tighten the "single import site" AC's precision.** The grep-style check implied by AC3 should explicitly rule out `require("ink")` and re-export bypasses, not just static/dynamic `import`.

**6. `viewHost` seam is unaddressed.** The intent requires preserving `viewHost`/`inkRender` seams on every shipped ink surface, but the subspec discusses only `inkRender`. Add either seam coverage for `viewHost` in this subspec or an explicit "not applicable" line with reasoning.

**7. `v1-behaviors.md` update is premature as worded.** "Closing the prior isolation gap" asserts a runtime fix that no AC currently proves. Once #1 is resolved with a real runtime-verifying AC, this doc line is fine as-is; until then it overstates what the subspec demonstrates.

Not required: auditing pre-existing `test.skip` usage elsewhere (out of this subspec's scope; AC4 already blocks new skips) and adding a refactor-style test citation (no pre-existing test exists to cite, so the citation convention doesn't apply — though the spec may note the absence of a pre-refactor safety net as a known limitation).
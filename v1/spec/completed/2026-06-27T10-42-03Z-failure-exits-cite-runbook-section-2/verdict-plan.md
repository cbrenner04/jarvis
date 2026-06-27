## Verdict

Four findings are upheld and require refinement. One borderline finding is upheld as a minor tightening. Finding 1 is dismissed.

---

**1. Exit reason string format — resolution required**

The string reaching `runSummary` is `"no-progress (exit code 4)"`, not `"no-progress"`. The mapping in the Decisions section names bare reason strings with no guidance on how an implementer should match against the suffixed form. The spec must state the matching strategy (e.g., the suffix is stripped or the key is applied before the suffix is appended) so the mapping is unambiguous.

**2. `### Recovery by exit reason` heading guard is mis-stated**

The spec claims both cited sections are "asserted stable by `v1/test/init.test.ts`." That test's heading-stability assertions cover only H2 headings; `### Recovery by exit reason` (H3) is not guarded. The claim is factually incorrect. The task checklist must include an explicit item to extend the `init.test.ts` heading guard to cover the H3 section. AC bullet 5's guard claim must reflect the actual (post-fix) state, not the current aspirational one.

**3. `ready-stuck-red` missing from the exhaustive AC inventory**

AC bullet 1 names `ready-stuck-red` → `Recovery by exit reason`. AC bullet 3 presents an exhaustive list of non-success reasons but omits `ready-stuck-red`. The list is internally inconsistent and must include it.

**4. No-telemetry early-return path unaddressed**

`runSummary` has an early-return path (when no telemetry exists) that prints `exit reason: ${args.exitReason}` and returns without reaching the full summary renderer. If the pointer is wired only into the full path, the early-return path silently drops it. The spec must state explicitly whether the pointer appears on the no-telemetry path. (Consistency argues yes — `runExitReason` is available on that path — but the spec must commit rather than leave it to the implementer.)

**5. `prompt-mode` not explicitly excluded (minor tightening)**

The spec already records plan-mode exclusion as a decision. `promptSummary` also prints an `exit reason:` line and could plausibly receive the pointer under the same reasoning. Since the spec explicitly excluded plan mode, add an equivalent decision for prompt-mode so the scope is unambiguous and an implementer cannot reasonably add the pointer there.
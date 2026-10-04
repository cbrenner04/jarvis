Validating key advocate claims against the codebase before issuing the verdict.
## Verdict: refinements required

The intent is sound — remove the production invert hook and prove the partition guard via source mutation on `bulletsForBoundary`. The subspec needs these corrections before merge:

### Blockers

1. **Fix verification commands for `shared/**` scope.** Tasks and the final AC name only `bun run test:v2`, but `shared/module-boundary-surfaces.test.ts` is exercised by `test:shared`, not the v2 runner. Per repo guidance, touched `shared/**` files require at minimum `typecheck`, `test:v1`, `test:v2`, and `test:integration:v2` (or an equivalent union that actually runs the rewritten test file).

2. **Remove the pre-fix failing AC.** The criterion that the rewritten guard-inversion test “fails against pre-fix production hook export and passes after removal” is false: with the hook present but never toggled, positive assertions under the real guard behave the same. Export removal is already covered by the structural grep AC. This is refactor work, not new behavior — spec guidance calls for preservation (“stays green”) citations, not a failing-test AC against baseline hook presence.

### High priority

3. **Add an AC that binds the comment checkpoint.** Decisions and tasks require a comment on the pinning test naming the `bulletsForBoundary` mutation (`return bullets.filter(...)` → `return [...bullets]`). Without an AC, an implementer can omit the comment while ticking everything else. Match established repo practice (e.g. workflow-collapse): an explicit AC, with `(Manual)` operator verification if automated enforcement is not wired.

4. **Clarify what the dedicated pinning test must prove.** The manifest loop’s k2 iteration already asserts draft-scope preservation under the real guard. The spec must state whether the named test (a) carries partition-isolation assertions the loop does not express, or (b) consolidates into the manifest test with the comment checkpoint there. Either path is valid; leaving it implicit invites redundant or hollow coverage.

5. **Soften mutation-uniqueness in the mutation AC.** Applying `return [...bullets]` would also RED other k2 assertions (including the manifest loop). The AC should require the named test turns RED under the named mutation, not that it is the sole failure surface.

### Medium priority

6. **Add refactor preservation ACs.** Pair hook removal with “stays green” citations for pinning tests whose behavior is unchanged — at minimum the k2 manifest normalization test and any other shared-surface tests that import or exercise `module-boundary-surfaces` without the invert flag.

7. **Make mutation verification operator-explicit.** The mutation AC does not say how verification happens (local edit, verifier script, operator check). Mark it `(Manual)` or reference the documented verifier pattern so agents do not tick it speculatively.

8. **Align `intent.md` with the corrected subspec.** Drop the broken pre-fix failing criterion if it appears in the subspec only. Fix intent wording: “when its named mutation is **inverted**” is ambiguous; “**applied**” (or equivalent unambiguous language) matches the source-mutation contract.

### Minor (non-blocking but should land in the same pass)

9. **Echo prerequisites in the subspec.** `intent.md` gates on completed write-step rules forbidding production invert hooks; the subspec should carry the same satisfied prerequisite (or note that static scanning is deferred to `guard-production-test-flags`).

10. **Resolve test-name vs. semantics drift.** Keeping `inverting partition guard fails k2 draft-scope preservation` while asserting positive behavior under the real guard is misleading; tasks should rename the test or explicitly forbid reintroducing setter-based inversion.

### Rationale

Refinements 1–2 prevent false completion signals: wrong test slices and an AC that cannot fail on pre-fix code violate agent-verifiable, worktree-local verification. Refinements 3–5 close gaps between decisions/tasks and enforceable outcomes — the comment checkpoint is part of the guard-inversion contract in `test-writing.md` and sibling completed specs. Refinements 6–8 apply spec-guidance refactor pairing (preservation, not false failing-test ACs) and established manual mutation verification. Refinements 9–10 improve traceability and reduce reintroduction risk without changing the design.

### No change required

- Documentation “None” is correct (harness-only, test-only export removal).
- The structural grep AC is appropriate interim enforcement until `guard-production-test-flags` lands.
- Widening the four-shape forbidden-hook AC is optional consistency, not required for this single-hook surface.
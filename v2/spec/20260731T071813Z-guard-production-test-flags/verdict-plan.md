Reviewing the spec against the repo to validate advocate claims and issue a focused verdict.
## Verdict: required refinements

1. **`check` script coupling to `ready-script` test**  
   Appending the new guard to `package.json` `check` changes the exact string pinned in `v1/test/ready-script.sandbox-unrunnable.test.ts`. The spec must require updating that assertion (task + AC) so `bun run test` does not fail after wiring the guard. Prior guard specs omitted this and wasted a cycle.

2. **Test-file exclusion must cover `.test.tsx`**  
   The spec scans `*.tsx` production files but excludes only `*.test.ts`. The tree has `v2/src/tui/*.test.tsx`; those paths would be scanned incorrectly. Decisions, tasks, AC allowed-case wording, and the guard-inversion pin must treat test files consistently (e.g. `*.test.ts` and `*.test.tsx`, or a `.test.` extension rule). Include at least one synthetic fixture on a `*.tsx` path (allowed and/or rejected) so TSX scanning is covered.

3. **`shared/prompts/step-rules.ts` exemption**  
   Merged write-step rules quote the forbidden identifier patterns in a string literal. A naive scan will fail `bun run check` on a clean tree. The spec must decide and document how the guard skips that case (path exemption vs string-literal-only detection) and reconcile that with the “zero production allowlist” outcome—hook-name allowlists are not the only exemption shape. Without this, the `bun run check` AC is unreachable after prerequisites land.

4. **Sync `intent.md` with index and subspec**  
   Intent prerequisites list only export/module-variable shapes; index lists all four. Intent AC #2’s `invert*` / `*ForTest` parameter wording implies bare `*ForTest` parameters; subspec correctly limits to `invert*`-prefixed parameters plus the other three shapes. Intent decisions still say exclude only `*.test.ts` while subspec adds TSX scanning. Align intent with the authoritative four-shape model and test-file exclusion before plan validation treats the seed literally.

5. **Implementation ordering**  
   `implement-queue.md` and sibling hook-removal specs state this guard lands **last** in the mutant-fix chain. Index prerequisites list merged siblings but not the inverse rule: implementing before hook removal leaves residuals that fail `bun run check`. Add one prerequisite or decision line so implementers do not start this spec on a tree that still carries forbidden hooks.

6. **Narrow documentation scope**  
   Coding-standards and intent doc tasks claim “no production state exists solely for tests” as a general principle. Other `*ForTest` hooks remain out of scope. Docs must prohibit only the four invert shapes, name `scripts/guard-production-test-flags.ts`, and list all three scan roots (`v2/src`, `v1/src`, `shared`)—deliberately broader than the sync-subprocess bullet, which omits `v1/src`.

7. **Guard-inversion AC: pinning-test checkpoint**  
   `v2/docs/test-writing.md` requires a comment checkpoint on the **pinning test** naming the guard-source mutation. The inversion AC references the guard mutation but does not require the pinning-test checkpoint. AC wording should match the established guard-inversion contract.

---

**Rationale:** Items 1–3 block a green implement run on the post-prerequisite tree or fail the suite after wiring. Items 4–5 prevent plan/implement drift and wrong sequencing. Items 6–7 keep docs and inversion evidence aligned with repo conventions and sibling guard specs.

**Not required:** Splitting the subspec; roster inclusion for `scripts/guard-*.test.ts`; per-shape inversion pins beyond the extension gate; direct CLI/walker unit tests; `operator-runbook.md` update; excluding `v2/src/testing/`; mandating AST parsing.
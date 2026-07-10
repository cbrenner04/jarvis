## Verdict

**Upheld — must refine:**

1. **New-behavior test coverage missing.** 00's ACs only assert that *existing* suites stay green (regression coverage); none pin the new logic itself. Add ACs that exercise `resolveReadyTestScope` and the `getReadyCommands` substitution directly against representative diffs (e.g., a `v1/**`-only diff resolving to `test:v1`/`test:integration:v1`; a multi-surface diff producing one `bun run <script>` step per resolved script). This is new functionality, not a preservation case, so it needs its own new-behavior ACs per spec guidance, not a "stays green" citation.

2. **Untracked files must be included in scope classification.** The stated rationale for using the working tree (uncommitted edits should count) is broken if new, untracked files are silently excluded from `git diff --name-only <mergeBase>`. Update 00's decision to explicitly enumerate both tracked diff and untracked files (e.g. via `git status --porcelain` or equivalent) when building the changed-path set, and add an AC covering a new-file-only diff.

3. **Serial-retry-on-flake loss must be documented as a behavior change.** 00 knowingly accepts that scoped per-surface test steps get no serial retry, but 01's `v2/docs/v1-behaviors.md` update only mentions scoping, not this regression in flake-retry coverage. Add a line to 01's documentation-updates bullet calling out that scoped test steps run without the serial-retry safety net that the unscoped `bun run test` step has.

4. **End-to-end empty-scope AC needed.** 01's ACs cover the `v1/**`-only and `shared/**` cases but not a docs/specs-only diff run through an actual call site, which is the case most likely to break downstream assumptions that a test step always runs. Add one AC in 01 exercising an empty-scope (docs-only) diff through one real gate call site, confirming the test step is dropped without error.

5. **Clarify baseBranch reuse between review baseline and review final.** These two gates share a resolved `baseBranch` value but independently reclassify against their own diff at call time — the current wording could be misread as identical scope. Add one clarifying clause to 01's decision stating this explicitly.

**Not upheld — no refinement required:**

- Fast/full tier substitution symmetry: acceptable as stated, but implementer should verify (not a spec-level gap) that both tiers currently invoke unscoped `bun run test` as their sole test step before relying on "same position" substitution.
- `getBaseBranch` parity at triage: existing call site already depends on it; if unusable there, that's an implementation-time blocker, not a spec defect.
- Plan mode / `auto-integrate-base.ts` exclusion: the intent and 01 already scope this explicitly to the six named patch-mode call sites; this is a defensible, stated boundary.
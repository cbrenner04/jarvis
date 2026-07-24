# Adjudicator verdict: help-lists-registered-flags

## Required refinements

1. **Intent examples must match shipped parsers**  
   Remove `--no-auto-bounce` from `intent.md` (and any mirrored ready-intent). It is no longer accepted on the surfaces this work touches; keeping it in the seed contradicts runtime behavior and misleads implementers.

2. **Intent problem statement must match deliverable scope**  
   Narrow the problem from “no `jarvis` command lists its flags” to the paths covered by intent acceptance criteria (workflow presets plus `write`, `cleanup`, `run list`, `daemon log`, and `run start` parity with `write`). Title breadth is fine; the problem line should not imply full-CLI coverage in this spec.

3. **Subspec `00`: failing-test acceptance criterion must cover all three workflow presets**  
   The criterion that names a pre-fix-failing test must apply to `intent`, `plan`, and `implement` (named tests or one clearly scoped regression group). Spec guidance requires a named failing-test surface per runtime-behavior subspec; prose AC #1 already binds all three presets.

4. **Subspec `00`: `v1-behaviors.md` for operator-visible help change**  
   Spec guidance requires updating `v2/docs/v1-behaviors.md` when existing behavior changes. Workflow preset help gains structured flags in `00`, so either add a minimal documentation-updates entry in `00` for that catalog change, or document at index level why the catalog update is intentionally deferred to `01` without leaving `00` “complete” but guidance-noncompliant. Prefer a minimal `00` entry if the behavior is already user-visible after `00` lands alone.

5. **Subspec `01`: parser parity must have a single source of truth (specified as outcome)**  
   Decisions or work must state that parity compares registry metadata to the same option set the parser uses—not a third hand-maintained list in tests. The spec need not mandate a particular module shape, but it must require one authoritative definition per command path so anti-drift intent is enforceable in review.

6. **Subspec `01`: pin operator-visible flag line conventions in docs**  
   `write-behavior.md` (per intent and `01` documentation updates) must define how lines are rendered: canonical long names, `argumentShape` for booleans and value-taking flags, ordering, and whether short aliases (e.g. `-y`) appear as separate lines or only under the long form. Without this, `write`/`cleanup`/`run start` can satisfy tests while diverging in UX.

7. **Subspec `01`: document usage prose vs structured flags**  
   Documentation must state that `usage:` lines may still mention flags until error-path usage is shortened later (`01` already defers shortening). Operators should not read the spec as requiring immediate deduplication of `usage.ts` prose.

8. **Subspec `01`: work must include updating existing help stdout tests**  
   Add an explicit work (or acceptance) outcome that any tests asserting exact `jarvis help …` stdout—including `cli.test.ts` and `renderHelpNode` coverage—are updated when flag lines are added. `00`’s “stdout otherwise unchanged” applies only to workflow leaf nodes, not a global freeze on help tests for `write` and siblings.

9. **Subspec `01`: clarify layered workflow checks (optional but recommended as one decision sentence)**  
   State that `help-flags-parity.test.ts` is the long-term authority for which flags each node must list, including workflow presets after `01`, while `00` regressions remain focused smoke. Resolves duplicate enforcement without mandating deletion of `00` tests.

## Not required

- **Split subspec `01`** into multiple index entries: one mechanical slice (registration + parity guard + docs) with serial dependency on `00` for workflow in the parity matrix is acceptable; paths are not cleanly independently verifiable for intent AC #3 until the shared guard exists, but that is index ordering, not oversize forcing a split.

- **Reverse parity** (registry flags the parser rejects): not required for this intent; parser→help gaps are the stated risk.

- **Parent `help run workflow` `[flags]` usage prose**: out of scope unless a follow-up intent; not a blocker for this spec.

- **Adding `--project` to intent examples**: parity will cover it; optional seed polish only.

## Rationale (summary)

Refinements tie the spec to **accurate intent**, **spec guidance** (failing-test AC per subspec, `v1-behaviors` on behavior change, agent-verifiable outcomes), and **implementability** (parity source of truth, stdout test churn, alias/format conventions). Core design—registry `flags`, tab-separated help lines, workflow-first then remaining commands with parser-driven tests—stands; these items close gaps that would otherwise cause guidance violations, review churn, or drift between parsers, tree metadata, and tests.
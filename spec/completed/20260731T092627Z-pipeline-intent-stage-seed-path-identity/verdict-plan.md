Verifying key codebase and spec conflicts cited in the review before issuing the verdict.
# Verdict: required refinements

## 1. Reconcile with completed prior-worktree spec

The completed `pipeline-stage-resolve-prior-worktree` spec pins first-stage input as `PipelineContext.seed` and requires `"first workflow stage builds with PipelineContext.seed as the seed input"` to stay green. This spec changes that contract (path seeds → `IntentWorkflowInput.seed`, inline → `seedText`, never both) while leaving `cwd: PipelineContext.cwd` unchanged.

**Required:** State explicitly that this spec supersedes prior-worktree first-stage **seed** routing only; `cwd` anchoring is unchanged. Replace the blanket preservation implication with updated preservation citations: split or evolve the existing first-stage test into path-branch and text-branch cases, each citing the post-change test names per spec-guidance refactor-AC rules.

**Rationale:** Without supersession language, implementers face contradictory specs and a preservation AC that encodes the bug.

---

## 2. Sync `intent.md` with the subspec

`intent.md` drifts from the implementer contract in several ways:

- Wrong symbol: `resolveIntentSeed` → `resolveSeed`
- Missing decision: first workflow stage only; chained stages stay artifact-driven
- Stale AC2 escape hatch: `intent-split-regression.test.ts` (that file does not cover landing/consumption; subspec correctly collapses to `pipeline-stage-resolve.test.ts`)
- AC detail level: subspec carries `Mutation checkpoint:` guards; intent ACs do not

**Required:** Align `intent.md` decisions and acceptance criteria with the subspec. Either carry mutation-guard language into intent ACs or state that subspec ACs are authoritative for guard inversion. Remove the `intent-split-regression` alternative from intent AC2.

**Rationale:** Intent is the behavior contract; drift causes wrong implementation or weaker tests.

---

## 3. Strengthen identity AC with `paths` contract

Decisions require slug, name, label, **and `paths`** parity with standalone `--seed <path>`. AC1 asserts only slug/name/label; a fix could pass AC1 with `paths: []` until AC2 fails.

**Required:** Extend AC1 (intent and subspec) to assert path-seed resolution records non-empty consumption paths at resolution time—e.g. `landing.inputs.paths` on the resolved write step and/or explicit `paths` parity in the pipeline-vs-standalone builder comparison.

**Rationale:** Closes the gap between decisions and verifiable outcomes; gives resolution-level coverage of the consumption wiring, not only post-landing E2E.

---

## 4. Pin the frontmatter-leading fixture

“Frontmatter-leading fixture” and the `name-`-prefixed slug failure mode are not pinned. Implementers could choose a fixture that does not distinguish path vs text routing.

**Required:** Task checklist must specify fixture location (realistic operator path, e.g. under `v2/spec/seeds/`), content (YAML `name:` leading the file, body unrelated to slug), and expected slug/name/label values proving path-branch resolution—not inline `name-` slug artifacts.

**Rationale:** The primary regression is mis-routing file content through `seedText`; the fixture is the test's contract.

---

## 5. Specify consumption-test harness preconditions

AC2 asserts the seed file is absent from the worktree after landing, but does not state fixture preconditions. With `consumeFrom: "worktree"`, consumption only deletes paths present in the intent worktree; a test where the seed exists only in admission `cwd` could pass wiring checks while proving nothing about operator outcome.

**Required:** Task checklist and/or AC2 must pin: git fixture with seed committed on base branch; resolve first intent stage with `seedPath` via real builders; land via publication landing on the intent worktree; assert seed absent from the **intent worktree** (not admission `cwd`). Add a decision that consumption parity assumes the same git/worktree preconditions as standalone file-seed intent.

**Rationale:** AC2 must prove end-to-end operator outcome, not just correct `IntentWorkflowInput` shape.

---

## 6. Reframe inline-seed AC as preservation

`--seed-text` behavior is correct pre-fix; AC3 is written as new behavior.

**Required:** Reframe AC3 as preservation: cite the evolved post-split inline-seed test(s) (successor to the current blanket `PipelineContext.seed` test), assert `paths: []` and no seed paths for deletion, and retain the `seedPath`-on-text-branch mutation guard.

**Rationale:** Spec guidance requires preservation ACs to cite pinning tests, not paraphrase assumed behavior.

---

## 7. Close dispatch edge-case gaps

Several dispatch branches are unspecified:

| Case | Required outcome |
|------|------------------|
| Both `seedPath` and `seed` populated | State dispatch precedence (e.g. prefer `seedPath`) or explicitly defer corrupt/dual rows as out-of-scope legacy with defined load-as-stored behavior |
| Neither field set | State whether resolution-time omission is acceptable (builder rejects later) or requires an explicit error |
| Legacy `seed`-only persisted rows (pre-`seedPath`) | State out-of-scope: route through `seedText`, no migrate-on-read |
| Pipeline resume with persisted `seedPath` | One-line decision: first-stage re-resolution uses same dispatch branch |

**Rationale:** Dispatch XOR is the core fix; ambiguous persisted shapes are a real regression vector even if admission normally prevents them.

---

## 8. Tighten problem prose

Problem statements say seed files “survive on `main`.” Consumption deletes under the intent worktree (`consumeFrom: "worktree"`); the source checkout copy may remain.

**Required:** Rephrase to the observable symptom: seed queue file is not consumed from the intent worktree after landing (operator still sees it in their checkout). Optionally note `cwd` anchoring is unchanged from prior-worktree.

**Rationale:** Accurate mechanism prevents implementers from asserting wrong deletion scope.

---

## 9. Documentation tasks: make parity explicit

Doc touchpoints are listed but thin on dispatch/consumption parity.

**Required:** Task checklist must require: `daemon-host.md` first-stage hand-off documents `seedPath` vs inline `seed` (replacing seed-only prose); `workflow-runner.md` states first-stage pipeline intent write steps carry `landing.inputs.paths` from admitted `seedPath` same as CLI `--seed`; `v1-behaviors.md` adds dispatch and consumption parity bullets (admission `seedPath` may already be recorded).

**Rationale:** Four doc files are appropriate for this behavior surface; tasks should state what parity means, not just “update.”

---

## Not required: subspec split

Dispatch, identity, consumption, and inline regression share one code seam (`resolveIntentStage`) and one primary test file. Keeping a single subspec is acceptable **provided** AC1 gains `paths`/landing-input coverage (refinement 3) and AC2 pins the git fixture contract (refinement 5). Split into `01-…` only if consumption harness cannot live beside resolution tests without duplicating fixtures—which the codebase patterns do not require.

---

## Summary

Core design (route `seedPath` → `IntentWorkflowInput.seed`, inline `seed` → `seedText`, reuse `resolveSeed` path branch, prerequisites already landable) is sound. Merge is blocked on: **prior-spec supersession**, **intent/subspec sync**, **stronger AC1 `paths` contract**, **pinned fixture and consumption harness**, **preservation-framed AC3**, and **dispatch edge-case decisions**.
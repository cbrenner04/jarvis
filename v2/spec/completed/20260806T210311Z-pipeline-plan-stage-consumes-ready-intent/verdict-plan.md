Verifying key implementation claims so the verdict is grounded in the codebase.
# Verdict: Required refinements

## 1. Correct the diagnosed mechanism in Problem and Tasks

The spec frames the bug as missing consumption on the `plan-tree` landing path, but `landPlanTree` already invokes input consumption when `landing.inputs` is set, and standalone plan already works through `planSource`. Chained pipeline plan passes `cwd` from the prior entry-run worktree while `landing.inputs.paths` is built from `join(cwd, readyIntent)`, so the delete target does not resolve to the project-relative path on the plan worktree where the rematerialized ready-intent actually lives.

**Required outcome:** Problem and the primary task must state that the fix is making the shared `landing.inputs` contract produce the correct delete target when chained `cwd` differs from `project.root` — not adding a new consumption call or a pipeline-only landing fork.

**Rationale:** Without this, implementers may edit `publication-landing.ts` looking for a missing `consumeInputs` call and miss the actual failure mode. The intent's decision to stay on the shared `planSource` / `landPlanTree` path depends on naming this correctly.

## 2. Realign Surface to the actual primary edit seam

`publication-landing.ts` is listed first as the primary surface, but the likely fix lives in `planSource` / `buildPlanWorkflowSteps` path construction, with `publication-landing.ts` as the existing consumer.

**Required outcome:** Surface must identify `publication-workflow-steps.ts` (`planSource` / `landing.inputs` construction) as the primary seam and demote `publication-landing.ts` to the shared landing contract it already implements.

## 3. Realign the mutation checkpoint to the path-construction guard

The mutation AC targets "pipeline plan ready-intent deletion on landing" in `publication-landing.ts`. Mutating the shared `consumeInputs` call there would either turn the standalone preservation test red (wrong pinned test) or stay hollow if the real fix is in `planSource` path construction.

**Required outcome:** The `// @mutate` directive and its matching acceptance criterion must anchor on the line that constructs or normalizes `landing.inputs.paths` for plan workflows (the guard that makes chained ready-intent deletion happen), with AC wording that matches that anchor. Per spec guidance, the pinned regression test — not a sibling preservation test — must go red when the mutation is applied.

## 4. Clarify the regression test's observable contract

"Committed file set no longer includes the ready-intent" is ambiguous and stricter than the repo's established pinning pattern. The standalone preservation test (`"lands the byte-identical ready intent before consuming plan inputs"`) asserts the ready-intent path appears in `git diff --name-only` on the plan worktree after landing — the contract that deletion will be part of the publication commit/PR diff.

**Required outcome:** The new regression test's task and acceptance criteria must specify an assertion aligned with that established contract (e.g., ready-intent absent from tracked state and present in landing diff, or equivalent proof that deletion reaches the publication commit), not an underspecified "committed file set" check.

## 5. Pin minimum test posture for production resolution and landing

"Drive through production resolution and landing hooks" is too vague; `pipeline-execution.test.ts` often stubs resolution, which could allow a narrow `landPublication` fixture test that passes without fixing chained resolution.

**Required outcome:** Tasks and/or acceptance criteria must require that the regression test resolves the plan stage through production preset builders (agent/write loop may be stubbed) and lands through the production landing boundary (`landPublication` or `landReviewedPublicationOutput` with the resolved write step's `landing` object) — not a hand-built `landing` object or test-local reimplementation.

## 6. Address the `full-review` / review-deferred landing gap

The problem statement names the `full-review` pipeline, where plan landing is deferred through `workflow-runner.ts` review completion. A fix to `landing.inputs` at resolution time should flow through both paths, but the spec does not require the regression test to exercise reviewed landing.

**Required outcome:** Either the regression test must use a reviewed plan preset and land through the review-deferred production path, or the spec must explicitly justify why `review: "none"` resolution plus `landPublication` is sufficient coverage given shared `landing` object identity. Leaving this unstated leaves a real confidence gap for the named failure scenario.

## 7. Sync `intent.md` documentation updates with the subspec

The subspec correctly requires `v2/docs/v1-behaviors.md` per spec guidance for behavior changes. `intent.md` omits it.

**Required outcome:** `intent.md` Documentation updates must include `v2/docs/v1-behaviors.md` recording that pipeline plan landing consumes the chained ready-intent on the same `plan-tree` path as standalone plan.

## 8. Optional but low-cost: fan-out coverage note

Fan-out plan stages bind per-branch ready-intents via `resolveForDownstreamPaths`; the same `planSource` path fix should apply per branch, but the spec is silent.

**Required outcome (optional):** One sentence acknowledging that each fan-out plan branch consumes its bound ready-intent on landing, or an assertion on one fan-out branch in the regression test. Omitting this is a coverage gap, not a scope expansion.

---

**Summary:** The spec targets the right outcome and scope (shared landing path, no artifact-handoff changes, preservation of standalone behavior). It is not ready to implement as written because it misdiagnoses the mechanism, points mutation and surface at the wrong seam, and leaves the regression test's driving path and assertion contract underspecified relative to repo conventions and the named `full-review` failure mode.
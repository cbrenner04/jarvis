# Inject agent core at every SPEC_GUIDANCE site

## Problem

Every `SPEC_GUIDANCE` producer still reads `v1/docs/spec-guidance.md`, shipping operator CLI and resolution prose into plan draft, plan debate, plan actuator, and intent review prompts five to seven times per plan run.

## Decision ledger

- Centralize path resolution in `shared/` targeting `v2/docs/spec-guidance-agent-core.md`; rules out divergent per-engine hardcoded paths to different files.
- Every `SPEC_GUIDANCE` producer calls the shared resolver; rules out partial adoption that leaves one injection site on the monolith.
- Delete the local `getSpecGuidancePath` in `v2/src/execution/write.ts` in favor of the shared export; rules out duplicate helpers that drift.
- Plan and intent prompt tests that load bundled guidance read `v2/docs/spec-guidance-agent-core.md`, not the monolith; rules out fixtures that break when subspec 01 replaces the monolith with operator-only content.
- Extend `write.test.ts` test `plan preset draft step isolates bundled human-only marker guidance` with operator exclusion and agent-verifiable AC retention assertions in the same extracted `SPEC_GUIDANCE` block; rules out a parallel sibling test that duplicates incomplete extraction coverage.
- Repoint `test/spec-guidance-doc-assertions.test.ts` read target to `v2/docs/spec-guidance-agent-core.md` in subspec 00; rules out a root `test/**` regression when subspec 01 replaces the monolith with no spec-owned fix.
- Pin operator exclusion with `jarvis1`, `## Plan same-seam siblings serially`, and `~/.jarvis/specs/` absent from extracted plan-draft `SPEC_GUIDANCE`; pin agent-core retention with human-only marker guidance, agent-verifiable AC rules, `## Acceptance criteria`, `## Blocker`, `Do not hard-wrap authored markdown`, `Behavior-preserving (refactor) ACs`, and `Rule-out and invariant guards` present; rules out swapping files without changing injected content.

## Prerequisites

- `v2/docs/spec-guidance-agent-core.md` and `v1/docs/spec-guidance-operator.md` exist with a lossless paragraph partition of the merge-base `v1/docs/spec-guidance.md` monolith (split spec `20260831T095540Z-split-spec-guidance-documents`).

## Task checklist

- Add `shared/spec-guidance-path.ts` (or equivalent) exporting install-root resolution for `v2/docs/spec-guidance-agent-core.md` and a `readSpecGuidance()` helper if useful.
- Wire the shared resolver at every current monolith read: `shared/prompts/review-plan.ts`, `shared/prompts/review-intent.ts`, `v2/src/execution/write.ts`, and `v1/src/modes/plan/{draft,review,verdict-actuator}.ts`.
- Point bundled-guidance test fixtures at the agent core: `shared/prompts/plan-draft.test.ts`, `v1/test/modes/plan/prompts.test.ts`, and `v2/src/execution/plan-workflow-steps.test.ts`.
- Repoint `test/spec-guidance-doc-assertions.test.ts` from `v1/docs/spec-guidance.md` to `v2/docs/spec-guidance-agent-core.md`.
- Extend `v2/src/execution/write.test.ts` test `plan preset draft step isolates bundled human-only marker guidance`: keep existing human-only marker retention assertions; add operator exclusion (`jarvis1`, `## Plan same-seam siblings serially`, `~/.jarvis/specs/` absent) and agent-verifiable AC guidance retention in the same extracted `SPEC_GUIDANCE`; add a co-located `// @mutate` inverting the shared resolver read target.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` test `plan preset draft step isolates bundled human-only marker guidance` asserts extracted `SPEC_GUIDANCE` has no `jarvis1` substring and no `## Plan same-seam siblings serially` or `~/.jarvis/specs/`, and still contains human-only marker guidance and agent-verifiable AC guidance; fails against the pre-fix monolith injection.
- [ ] `v2/src/execution/write.test.ts` — co-located `// @mutate` inverting the shared agent-core path resolver (or read target) flips the operator exclusion assertions above; fails when applied.
- [ ] `test/spec-guidance-doc-assertions.test.ts` reads `v2/docs/spec-guidance-agent-core.md`, not `v1/docs/spec-guidance.md`, and stays green.
- [ ] `shared/prompts/plan-draft.test.ts` test `renders named pre-fix failing-test guidance without checkpoint authoring` stays green against the agent-core fixture.
- [ ] `v1/test/modes/plan/prompts.test.ts` bundled-guidance tests stay green against the agent-core fixture (human-only marker guidance and agent-verifiable AC rule still render).
- [ ] `shared/prompts/review-profile.test.ts` stays green with the new injection source.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` stays green with the new injection source.
- [ ] `v2/src/execution/plan-workflow-steps.test.ts` stays green with the new injection source.

## Documentation updates

- Deferred to subspec 02.

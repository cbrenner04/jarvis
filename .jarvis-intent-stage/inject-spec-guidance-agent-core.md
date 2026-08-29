---
name: inject-spec-guidance-agent-core
---

# Inject only the spec-guidance agent core into plan and intent prompts

## Prerequisites

- Agent authoring-core and operator-guidance markdown exist with a lossless paragraph partition of the current `v1/docs/spec-guidance.md` monolith.
- The operator-guidance document preserves the operator-facing role of `v1/docs/spec-guidance.md` for existing cross-links.

## Surface

Execution loop.

## Problem

- Every `SPEC_GUIDANCE` injection site still reads the full monolith (`shared/prompts/review-plan.ts`, `shared/prompts/review-intent.ts`, `v2/src/execution/write.ts`, and `v1/src/modes/plan/{draft,review,verdict-actuator}.ts`), shipping operator `jarvis1` material into plan draft, plan debate, plan actuator, and intent review prompts 5–7 times per plan run.

## Behavior

- One shared resolver returns the agent authoring-core path; every `SPEC_GUIDANCE` producer reads that file instead of the monolith.
- Replace `v1/docs/spec-guidance.md` with the operator-guidance content (or a thin entry that serves the same operator contract) so the lossless split is true on disk with no duplicate paragraphs.
- Rendered plan-draft and intent/plan review prompts contain the core contracts and exclude operator-command substrings such as `jarvis1 run`.

## Decision ledger

- Centralize path resolution in `shared/` and consume it from v1 plan modes and v2 execution write; rules out divergent per-engine hardcoded paths to different files.
- `SPEC_GUIDANCE` reads only the agent core at every injection site named in the seed; rules out partial adoption that leaves one role on the monolith.
- Finalize `v1/docs/spec-guidance.md` as the operator entry point after the switch; rules out leaving three copies of authoring rules on disk.
- Pin exclusion with a grep for `jarvis1` inside extracted `SPEC_GUIDANCE` on the assembled plan-draft prompt; pin retention with render-test substrings for `## Acceptance criteria`, `## Blocker`, human-only marker guidance, and agent-verifiable AC rules.

## Acceptance criteria

- [ ] A regression test in `v2/src/execution/write.test.ts` drives a plan-draft write, extracts `SPEC_GUIDANCE`, and asserts it contains no `jarvis1` substring while still containing the human-only marker guidance and agent-verifiable AC guidance; it fails against the pre-fix monolith injection.
- [ ] That test carries `// @mutate` inverting the shared agent-core path resolver (or the `getSpecGuidancePath` read target) and fails when applied.
- [ ] `v1/test/modes/plan/prompts.test.ts` bundled-guidance tests stay green against the agent core (human-only marker guidance and agent-verifiable AC rule still render).
- [ ] Existing plan and intent render-coverage tests (`shared/prompts/review-profile.test.ts`, `v1/test/prompts/rendered-snapshots.test.ts`, `v2/src/execution/plan-workflow-steps.test.ts`) stay green with the new injection source.
- [ ] Every former `v1/docs/spec-guidance.md` section appears in exactly one on-disk document after the switch; the spec split inventory matches the landed files (no automated guard).
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run lint:md` pass.

## Documentation updates

- `v2/docs/prompts.md` — name the agent-core file as the `SPEC_GUIDANCE` injection source.
- `AGENTS.md` — repoint spec-guidance references if the operator entry path changes.
- `v2/docs/v1-behaviors.md` — record that plan and intent prompts inject the agent core only, not operator CLI guidance.

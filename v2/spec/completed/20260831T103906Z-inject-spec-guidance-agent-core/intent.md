---
name: inject-spec-guidance-agent-core
---

# Inject only the spec-guidance agent core into plan and intent prompts

## Prerequisites

- `v2/docs/spec-guidance-agent-core.md` and `v1/docs/spec-guidance-operator.md` exist with a lossless paragraph partition of the current `v1/docs/spec-guidance.md` monolith.
- The operator-guidance document preserves the operator-facing role of `v1/docs/spec-guidance.md` for existing cross-links.

## Surface

Execution loop.

## Problem

- Every `SPEC_GUIDANCE` injection site still reads the full monolith (`shared/prompts/review-plan.ts`, `shared/prompts/review-intent.ts`, `v2/src/execution/write.ts`, and `v1/src/modes/plan/{draft,review,verdict-actuator}.ts`), shipping operator `jarvis1` material into plan draft, plan debate, plan actuator, and intent review prompts 5–7 times per plan run.

## Behavior

- One shared resolver returns `v2/docs/spec-guidance-agent-core.md`; every `SPEC_GUIDANCE` producer reads that file instead of the monolith.
- Overwrite `v1/docs/spec-guidance.md` with the operator-guidance content from `v1/docs/spec-guidance-operator.md` and remove the staging file so the lossless split is true on disk with no duplicate paragraphs and no thin redirect stub.
- Rendered plan-draft and intent/plan review prompts contain the core contracts and exclude operator-only material (including prose with no `jarvis1` substring).

## Decision ledger

- Centralize path resolution in `shared/` targeting `v2/docs/spec-guidance-agent-core.md` and consume it from v1 plan modes and v2 execution write; rules out divergent per-engine hardcoded paths to different files.
- `SPEC_GUIDANCE` reads only the agent core at every injection site; rules out partial adoption that leaves one role on the monolith.
- Overwrite `v1/docs/spec-guidance.md` with the operator document content (full replace at the existing path); rules out a thin redirect stub and leaving three copies of authoring rules on disk.
- Pin exclusion with a grep for `jarvis1` and at least one operator-only marker without that substring (`## Plan same-seam siblings serially` or `~/.jarvis/specs/`) inside extracted `SPEC_GUIDANCE` on the assembled plan-draft prompt; pin retention with render-test substrings for `## Acceptance criteria`, `## Blocker`, human-only marker guidance, agent-verifiable AC rules, no-hard-wrap guidance (`Do not hard-wrap authored markdown`), refactor-AC citation (`Behavior-preserving (refactor) ACs`), and rule-out reachability (`Rule-out and invariant guards`), plus `shared/prompts/plan-draft.test.ts` `renders named pre-fix failing-test guidance without checkpoint authoring` for the failing-test requirement.

## Acceptance criteria

- [ ] A regression test in `v2/src/execution/write.test.ts` drives a plan-draft write, extracts `SPEC_GUIDANCE`, and asserts it contains no `jarvis1` substring and no operator-only marker such as `## Plan same-seam siblings serially` or `~/.jarvis/specs/` while still containing the human-only marker guidance and agent-verifiable AC guidance; it fails against the pre-fix monolith injection.
- [ ] That test carries `// @mutate` inverting the shared agent-core path resolver (or the `getSpecGuidancePath` read target) and fails when applied.
- [ ] `v1/test/modes/plan/prompts.test.ts` bundled-guidance tests stay green against the agent core (human-only marker guidance and agent-verifiable AC rule still render).
- [ ] `shared/prompts/plan-draft.test.ts` `renders named pre-fix failing-test guidance without checkpoint authoring` stays green against the agent core.
- [ ] Existing plan and intent render-coverage tests (`shared/prompts/review-profile.test.ts`, `v1/test/prompts/rendered-snapshots.test.ts`, `v2/src/execution/plan-workflow-steps.test.ts`) stay green with the new injection source.
- [ ] Every former `v1/docs/spec-guidance.md` section appears in exactly one on-disk document after the switch; the spec split inventory matches the landed files (no automated guard).
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run lint:md` pass.

## Documentation updates

- `v2/docs/prompts.md` — name `v2/docs/spec-guidance-agent-core.md` as the `SPEC_GUIDANCE` injection source.
- `AGENTS.md` — repoint spec-guidance references if the operator entry path changes.
- `v2/docs/v1-behaviors.md` — record that plan and intent prompts inject the agent core only, not operator CLI guidance.

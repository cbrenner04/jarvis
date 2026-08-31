# Document agent-core SPEC_GUIDANCE injection

## Problem

Durable docs still describe or imply full-monolith `SPEC_GUIDANCE` injection and do not name `v2/docs/spec-guidance-agent-core.md` as the plan and intent prompt source.

## Decision ledger

- Record agent-core-only injection in `v2/docs/v1-behaviors.md`; rules out silent baseline rot on a v1-parity behavior change.
- Repair `v1-behaviors.md` cross-links so agent-core-only rule bullets target `v2/docs/spec-guidance-agent-core.md` and operator-workflow bullets stay on `v1/docs/spec-guidance.md`; rules out stale anchors after subspec 01.
- Name the injection source in `v2/docs/prompts.md` and `v2/docs/write-behavior.md`; rules out authoritative workflow docs still naming the monolith as `SPEC_GUIDANCE` source.
- Name `v2/docs/spec-guidance-agent-core.md` in `v2/docs/workflow-runner.md` install-root `SPEC_GUIDANCE` resolution prose; rules out mechanism doc with no post-switch file name.
- `AGENTS.md` keeps `v1/docs/spec-guidance.md` as the operator conventions entry when the path is unchanged; rules out gratuitous pointer churn.

## Prerequisites

- Subspec 00 lands shared resolver wiring.
- Subspec 01 lands operator monolith steady state.

## Task checklist

- Update `v2/docs/prompts.md` to name `v2/docs/spec-guidance-agent-core.md` as the `SPEC_GUIDANCE` injection source for plan and intent write/review prompts.
- Update `v2/docs/write-behavior.md` to name `v2/docs/spec-guidance-agent-core.md` as the `SPEC_GUIDANCE` injection source.
- Update `v2/docs/v1-behaviors.md` plan and intent prompt bullets to state prompts inject the agent core only, not operator CLI guidance; repair cross-links so agent-core-only rule bullets (e.g. failing-test requirement, rule-out guards, behavioral ACs, human-only ACs) target `v2/docs/spec-guidance-agent-core.md` while operator-workflow bullets (spec location, merge-first, external specs, non-index handling) stay on `v1/docs/spec-guidance.md`.
- Update `v2/docs/workflow-runner.md` to name `v2/docs/spec-guidance-agent-core.md` where install-root `SPEC_GUIDANCE` resolution is documented.
- Confirm `AGENTS.md` spec-guidance links remain correct at `v1/docs/spec-guidance.md`; edit only if the operator entry path changed.

## Acceptance criteria

- [ ] `v2/docs/prompts.md` names `v2/docs/spec-guidance-agent-core.md` as the `SPEC_GUIDANCE` injection source for plan and intent prompts.
- [ ] `v2/docs/write-behavior.md` names `v2/docs/spec-guidance-agent-core.md` as the `SPEC_GUIDANCE` injection source.
- [ ] `v2/docs/v1-behaviors.md` records that plan and intent prompts inject the agent core only, not operator CLI guidance, and cross-links agent-core-only rule bullets to `v2/docs/spec-guidance-agent-core.md` (not stale `v1/docs/spec-guidance.md` anchors for content that lives only in the agent core).
- [ ] `v2/docs/workflow-runner.md` names `v2/docs/spec-guidance-agent-core.md` for install-root `SPEC_GUIDANCE` resolution.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:v1` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/prompts.md` — `SPEC_GUIDANCE` injection source.
- `v2/docs/write-behavior.md` — `SPEC_GUIDANCE` injection source.
- `v2/docs/v1-behaviors.md` — agent-core-only plan and intent prompt injection; cross-link repair.
- `v2/docs/workflow-runner.md` — install-root `SPEC_GUIDANCE` file name.

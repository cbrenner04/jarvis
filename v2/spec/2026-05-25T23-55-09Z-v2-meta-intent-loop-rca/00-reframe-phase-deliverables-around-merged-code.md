# 00 - Reframe phase deliverables around merged code

## Decisions

- Change `v2/spec/v2-meta-index.md` from spec-deliverable framing to implementation-deliverable framing.
- State phase done as merged code in `v2/src`, not a merged dated spec.
- State `jarvis1 plan` as the drafting step and `jarvis1 run` as the implementation step.
- State phase briefs as build briefs sourced from the phase line plus the matching `v2/docs/v2-build-order.md` section.
- Require execution-voiced intents for phase starts; forbid "draft a spec" framing in the phase-start workflow.
- Treat `v2/spec/wip-intents/*.md` as generated evidence only; do not make them the durable fix location.
- Treat `v2/spec/2026-05-25T21-52-57Z-first-write-step-e2e/` as evidence only; do not salvage the meta-spec.
- Update every durable workflow doc made false by the new framing in the same change.
- Validate the new framing with one post-fix inline plan run against `v2/spec/v2-meta-index.md`.

## Constraints

- Keep this subspec to the source framing and its durable workflow docs.
- Do not harden prompt templates here; prompt contract work belongs to `01`.
- Do not scrap PR #153 or delete the evidence tree here; cleanup is follow-on work.
- Do not run a baseline reproduction before the fix; existing evidence already captures the failure.

## Assumptions

- The current meta-index header is the upstream source of the meta-intent loop.
- `v1/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md` are the durable workflow homes for this framing change.
- The first validation run is a leading indicator, not the whole acceptance gate.

## Task checklist

- Reframe the `v2/spec/v2-meta-index.md` header around merged implementation.
- Align `v1/docs/spec-guidance.md` with the new phase-start workflow and anti-meta intent wording.
- Align `v2/docs/v1-behaviors.md` anywhere the old "spec first" phase framing is recorded as operator guidance.
- Run one post-fix inline plan invocation and inspect the generated `v2/spec/wip-intents/*.md` artifact for execution-voiced framing.

## Acceptance criteria

- [ ] `v2/spec/v2-meta-index.md` says each phase delivers merged code in `v2/src`, identifies `jarvis1 plan` as the drafting step rather than the deliverable, and says phase completion is implementation merged.
- [ ] `v2/spec/v2-meta-index.md` tells operators to start a phase from the phase line plus the matching `v2/docs/v2-build-order.md` section and to write intents as build briefs rather than "draft a spec" requests.
- [ ] `v1/docs/spec-guidance.md` records the same workflow semantics in its durable operator guidance, including that specs are drafting artifacts and implementation is the phase deliverable.
- [ ] `v2/docs/v1-behaviors.md` is updated anywhere the old phase framing would leave v2 parity review with a stale operator workflow record.
- [ ] One post-fix inline `jarvis1 plan "the next phase of .../v2/spec/v2-meta-index.md"` run produces a generated `v2/spec/wip-intents/*.md` artifact whose top-level framing is execution-voiced for building code rather than drafting another spec.

## Documentation updates

- Update `v2/spec/v2-meta-index.md`.
- Update `v1/docs/spec-guidance.md`.
- Update `v2/docs/v1-behaviors.md`.

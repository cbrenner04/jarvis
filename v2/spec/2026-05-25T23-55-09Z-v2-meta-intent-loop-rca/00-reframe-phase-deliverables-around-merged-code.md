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

## Task checklist

- Reframe `v2/spec/v2-meta-index.md`.
- Align `v1/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md`.
- Run one post-fix inline plan invocation and inspect the generated `v2/spec/wip-intents/*.md` artifact.

## Acceptance criteria

- [x] `v2/spec/v2-meta-index.md` says a phase delivers merged `v2/src` code, treats `jarvis1 plan` as drafting, and treats done as implementation merged.
- [x] `v2/spec/v2-meta-index.md` tells operators to start from the phase line plus the matching `v2/docs/v2-build-order.md` section and to write a build brief, not a "draft a spec" request.
- [x] `v1/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md` record the same operator-facing workflow semantics.
- [x] One post-fix inline `jarvis1 plan "the next phase of .../v2/spec/v2-meta-index.md"` run produces a generated `v2/spec/wip-intents/*.md` artifact framed as building code, not drafting another spec.

## Documentation updates

- Update `v2/spec/v2-meta-index.md`.
- Update `v1/docs/spec-guidance.md`.
- Update `v2/docs/v1-behaviors.md`.

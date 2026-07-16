---
name: promotion-consumes-its-input
---

# Promotion Consumes Its Input

`seeds/` and `ready-intents/` must represent open work. Today v1 and v2 intent promotion retain file seeds, and v2 plan promotion retains ready-intents.

## Behavior

- After every successfully published v1 or v2 intent output is durable, consume each file seed the invocation read; inline seeds have no source artifact.
- After a successfully published v2 plan copies its ready-intent into the spec tree as `intent.md`, consume each ready-intent the invocation read, matching v1 plan behavior.
- Git-backed deletion lands in the produced artifact's commit; failed publication leaves every input intact and retry remains safe.
- Non-git publication consumes inputs only after all outputs land successfully.
- Resolve deletion targets inside the publication worktree and compare real paths on both sides; missing, external, or symlink-escaped targets are not deleted.
- Multi-output and batched promotion consumes every file input actually read, not merely the first.

## Decisions

- Promotion owns consumption at successful publication; rules out archive-time cleanup that leaves active backlogs stale.
- Input deletion and output publication form one success boundary; rules out an uncommitted or early deletion that can strand work.
- Ship both promotion hops across v1 and v2 as one lifecycle invariant; rules out a partial fix that leaves either backlog unreliable.
- Preserve the external-spec cleanup path unchanged; rules out widening this change into archival behavior.

## Documentation updates

- Update `v1/docs/spec-guidance.md`, `v1/docs/intent-mode.md`, and `v1/docs/plan-mode.md` so seeds and ready-intents are documented as open-work queues whose successful promotion consumes file inputs.
- Update the v2 workflow/operator durable docs for the same lifecycle and transactional boundary.
- Update `v2/docs/v1-behaviors.md` because v1 intent behavior changes.

## Prerequisites

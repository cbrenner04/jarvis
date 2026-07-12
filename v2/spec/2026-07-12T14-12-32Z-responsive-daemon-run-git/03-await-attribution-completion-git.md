# Await attribution and completion Git

Make daemon-hosted completion commits and attribution rendering yield to the event loop.

## Decisions

- Include completion commits and attribution rendering; rules out treating completion commit work as publication.
- Exclude push, PR publication, and ready finalization; rules out widening this change to completion publication policy.
- Preserve UTF-8 output, trimming, failures, fallback, and sequential commit/index cleanup order; rules out altering completion durability or attribution rendering.
- Keep in-flight Git uncancelled; rules out adding cancellation beyond committed daemon abort/shutdown semantics.

## Tasks

- [x] Replace synchronous Git execution in completion commits and PR-attribution rendering with awaited execution, propagating async contracts through their callers.
- [x] Preserve completion commit, attribution output, failure/fallback, and cleanup/order behavior.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with awaited attribution/completion-commit Git on daemon-hosted runs.
- Update `v2/docs/v1-behaviors.md` with the changed existing attribution/completion-commit behavior.

## Acceptance criteria

- [x] `v2/src/execution/completion-commit.test.ts` stays green for completion-commit behavior.
- [x] `v2/src/execution/pr-attribution.test.ts` stays green for attribution rendering behavior.
- [x] `v2/docs/v2-architecture.md` and `v2/docs/v1-behaviors.md` document awaited daemon run attribution/completion-commit Git.

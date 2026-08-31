# Write turns use distinct per-turn commit subjects

## Problem

Write loops call `commitSettledIteration` each turn but fall back to the persisted `creationTitle` keyed on the workflow index path when `binding.metadata.title` is absent (implement also receives `expectedArtifactPath` for the active subspec but still falls through). Published branches show multiple commits with identical subjects instead of per-turn labels.

## Surface

`v2/src/execution/write-loop.ts` (`commitSettledIteration` title resolution, `resolveAndPersistCreationTitle`), `shared/spec-parser.ts` (`parseSpec` H1), and co-located tests.

## Decision ledger

- Implement iteration commits use the active subspec file's H1 when `expectedArtifactPath` resolves to an existing subspec path under the spec tree; rules out reusing workflow `creationTitle` for every implement write turn.
- Plan `plan.prompt.draft` progress commits use v1 phase subject `plan: draft`; rules out persisting `creationTitle` (`plan: <name>`) on iteration commits.
- Intent `intent.prompt.split` progress commits use v1 phase subject `intent: split <N> intent(s)` from the staged ready-intent count at commit time; rules out persisting workflow `creationTitle` on split iterations.
- When a phase subject would repeat an existing branch subject, append the write-loop iteration ordinal; rules out duplicate subjects within the same phase.
- `binding.metadata.title` remains first preference when a factory populates it; rules out bypassing existing metadata plumbing.
- `creationTitle` remains workflow-scoped for terminal boundaries and PR header derivation; rules out removing `resolvePublicationTitle` / `setCreationTitle` persistence.

## Task checklist

- Extend `commitSettledIteration` title resolution: implement subspec H1 from `expectedArtifactPath` when that path exists and parses as a subspec file; plan draft and intent split phase subjects per ledger when metadata title is absent.
- Add a `workflow-runner-publication.test.ts` regression that drives plan publication across multiple write turns and asserts commit subjects ahead of base are pairwise distinct and none equal the persisted workflow `creationTitle` repeated on every turn (reachable pre-fix failure on base).
- Add a `workflow-runner-publication.test.ts` regression that drives intent publication with the same pairwise-distinct / not-all-`creationTitle` assertions.
- Add a `workflow-runner-publication.test.ts` regression that drives implement publication across multiple subspec write turns and asserts each write commit subject equals that turn's active subspec H1.

## Acceptance criteria

- [ ] `workflow-runner-publication.test.ts` test `plan publication uses distinct per-turn commit subjects` fails against the current duplicate-`creationTitle` behavior and passes after the fix.
- [ ] `workflow-runner-publication.test.ts` test `intent publication uses distinct per-turn commit subjects` fails against the current duplicate-`creationTitle` behavior and passes after the fix.
- [ ] `workflow-runner-publication.test.ts` test `implement publication write commits use active subspec H1 subjects` fails when every write turn reuses persisted `creationTitle` and passes when each subject matches the active subspec H1.
- [ ] `write-loop.test.ts` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

Deferred to [04 - Document per-turn publication commit history](./04-publication-commit-history-docs.md).

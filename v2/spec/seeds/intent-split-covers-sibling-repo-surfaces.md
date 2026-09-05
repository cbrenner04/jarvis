---
name: intent-split-covers-sibling-repo-surfaces
---

# Intent split covers sibling-repo surfaces instead of listing them as unmet prerequisites

## Problem

An `intent` run splitting a cross-repo seed enumerated module boundaries *within the launching repo only* and silently dropped the sibling repo's majority share of the work — while writing that dropped surface verbatim into the emitted intents' own `## Prerequisites`. Nothing failed: the run settled `completed`, and every downstream plan/implement would have built against endpoints and fields that do not exist. Evidence: #3439 (homestead seed `05-completion-skip-history` dispatched from `homestead-client`: three client-surface intents emitted, all naming unmet `homestead-service` prerequisites — the service stores no completion record and has no reopen/backdate routes).

The split has enough information to catch itself: an intent whose prerequisite is satisfied nowhere in the project or its `siblings`, and which no sibling intent in the same split delivers, is a detectable inconsistency at split time.

## Decisions

- The intent split checks each emitted prerequisite against the split's own output: a prerequisite delivered by no sibling intent and not already true of the project/`siblings` either produces an intent covering it or fails the split loudly; rules out the silent-drop `completed`.
- Cross-repo seeds route surfaces to intents per repo (the split prompt names `siblings` as first-class surfaces); rules out module-boundary enumeration scoped to the launching repo.
- Detection lives at split settlement, not in a reviewer's judgment; rules out relying on the operator reading emitted intents against two codebases.

## Acceptance criteria

- [ ] A test proves a split whose emitted intents name a prerequisite that no sibling intent delivers and the repos do not satisfy fails (or emits the covering intent) rather than settling `completed`; fails against the current silent drop.
- [ ] A single-repo seed's split behavior is unchanged, pinned by existing tests.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent-split prerequisite consistency check.

# 00 - Accept a non-empty `## Blocker` present at settle time

## Problem

`evaluateBlockerTextContract` (`v2/src/execution/step-runner.ts`) is satisfied only by `hasGenuineBlocker(contract.specBefore, specAfter)` — a before/after append within the settling invocation. A run that authored its `## Blocker` in iteration 3 and emitted `blocked` in iteration 4 (chess-mvp-yolo run `fb52cb87`) cannot satisfy it without appending a second, duplicate section; the reprompt is unwinnable and the row settles `missing_blocker` over an accurate, committed blocker.

## Decisions

- `evaluateBlockerTextContract` is satisfied when either the existing within-invocation append holds **or** `specAfter` contains a non-empty `## Blocker` section (via `extractBlockerBody`); rules out crediting only this invocation's append.
- The existing-section path reports that section's body as `blockerText`, so downstream `blocked` settlement carries the same operator-readable text as the append path.
- A `blocked` token with no `## Blocker` anywhere in the spec file still reprompts once and then settles `missing_blocker`; the `completionCheck` fallback for implement stays ahead of the reprompt exactly as today; rules out accepting a bare `blocked`.
- Harness-reserved `## Blocker` sections (`Artifact contract check failed:` marker, plan-draft only) are not agent blockers; the contract targets write-step spec files where that marker never appears, so no marker filtering is added.

## Acceptance criteria

- [ ] `step-runner.test.ts` test `a blocked token with a pre-existing non-empty ## Blocker settles blocked without a reprompt` seeds `specBefore` already containing the section, leaves the file unchanged during the invocation, and asserts `{ kind: "blocked", blockerText }` with no `blocker_reprompt` invocation; it fails against the append-only check.
- [ ] A test proves a fresh within-invocation append still settles `blocked` (existing coverage may be cited).
- [ ] A test proves a `blocked` token with no `## Blocker` present still reprompts once and then settles `missing_blocker`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-step-runner.md` and `v2/docs/write-behavior.md` — the blocker-text contract: a non-empty `## Blocker` present at settle time satisfies it, not only one appended during the settling invocation.

# Remove dead non-index runIteration path

## Problem

`resolveModeSpecificPreflight` (`v1/src/modes/patch/run.ts`) already blocks every
non-index spec: when `basename(specPath) !== "index.md"` it prints the `[s]`/`[e]`
prompt and the only non-exit branch sets `isIndexSpec = true` before returning.
So by the time `runIteration` runs, `isIndexSpec` is always `true`, and its
`!isIndexSpec` branches are unreachable in production:

- the `isIndexSpec &&` guard on the max-iterations check,
- the `: specPath` non-index fallback when picking `activeSubspecPath`,
- the `isFixupIteration && isIndexSpec` guard,
- the `if (!isIndexSpec) { … criteria-progress … }` single-iteration return block.

`v2/docs/v1-behaviors.md` documents this branch as a live behavior and a
`[v2-cleanup candidate]`; removing the code leaves that catalog stale.

## Decisions

- Remove the dead `!isIndexSpec` branches in `runIteration`; do not add a new non-index run mode. Rules out preserving legacy single-file iteration for ad-hoc use.
- Keep the preflight `[s]`/`[e]` prompt that handles non-index specs unchanged. Rules out also dropping the operator-facing prompt (out of scope; would change CLI behavior).
- Scope removal to the `runIteration` path; leave the `getSpecDisplayName` non-index display helper alone. Rules out a broader god-module cleanup.

## Task checklist

- [ ] Drop the always-true `isIndexSpec` guards and the `!isIndexSpec` branches in `runIteration`, simplifying `activeSubspecPath` to the index-routed lookup.
- [ ] Remove `isIndexSpec` references that are now constant-true; drop the preflight field only if no remaining code reads it.
- [ ] Update `v2/docs/v1-behaviors.md` entries describing the non-index runIteration iteration to state it is removed and non-index specs never reach the agent loop.
- [ ] Update/remove any test that drove the non-index iteration via the `confirmRun` seam.

## Acceptance criteria

- [ ] No code path in `runIteration` (`v1/src/modes/patch/run.ts`) branches on `!isIndexSpec`; the non-index `criteria-progress` single-iteration return is gone.
- [ ] Passing a non-index spec to `jarvis1 run` still prints the `[s]`/`[e]` preflight prompt and exits `0` on empty/`e` input without invoking an agent.
- [ ] `v2/docs/v1-behaviors.md` no longer presents the non-index runIteration iteration as a live or candidate path; it records that non-index specs are blocked at preflight and never reach the agent loop.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: correct the non-index runIteration entries to reflect the removed path (this subspec changes existing v1 behavior, so the parity baseline must be updated).

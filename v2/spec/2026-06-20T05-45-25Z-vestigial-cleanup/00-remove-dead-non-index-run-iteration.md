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

`v2/docs/v1-behaviors.md` documents this branch in two places: the
`[v2-cleanup candidate]` block, and a separate entry stating non-index runs
inline the operator-passed subspec path/body into the active-subspec block
without index routing — the exact behavior the removed `: specPath` fallback
produced. Removing the code leaves both entries stale.

## Decisions

- Remove the dead `!isIndexSpec` branches in `runIteration`; do not add a new non-index run mode. Rules out preserving legacy single-file iteration for ad-hoc use.
- Keep the preflight `[s]`/`[e]` prompt that handles non-index specs unchanged. Rules out also dropping the operator-facing prompt (out of scope; would change CLI behavior).
- Scope removal to the `runIteration` path; leave the `getSpecDisplayName` non-index display helper alone. Rules out a broader god-module cleanup.

## Out of scope / deferred

- Removing the `: specPath` fallback leaves `buildPrompt`'s non-index subspec-inlining branch without a production caller. Deferred to first consumer: remove or repurpose the now-unexercised `buildPrompt` non-index branch — pin when a caller needs it. Out of scope here to keep this subspec atomic.

## Task checklist

- [ ] Drop the always-true `isIndexSpec` guards and the `!isIndexSpec` branches in `runIteration`, simplifying `activeSubspecPath` to the index-routed lookup.
- [ ] Remove `isIndexSpec` references that are now constant-true; drop the preflight field only if no remaining code reads it.
- [ ] Update both `v2/docs/v1-behaviors.md` entries — the `[v2-cleanup candidate]` block and the separate non-index subspec-inlining entry — to state the path is removed and non-index specs never reach the agent loop. Fix any clause claiming the path is reachable via the test-only `confirmRun` seam (it is not).
- [ ] Keep the existing non-index preflight-prompt tests (empty/`e` input → exit at preflight); they back AC#2. There is no non-index iteration test to update or remove — the iteration was unreachable even via the `confirmRun` seam, so do not hunt for one.

## Acceptance criteria

- [ ] No code path in `runIteration` (`v1/src/modes/patch/run.ts`) branches on `!isIndexSpec`; the non-index `criteria-progress` single-iteration return is gone.
- [ ] Passing a non-index spec to `jarvis1 run` still prints the preflight prompt — `[s]`+`[e]` when a sibling `index.md` exists, `[e]` only when none does — and exits `0` on empty/`e` input without invoking an agent.
- [ ] Neither `v2/docs/v1-behaviors.md` entry (candidate block nor non-index subspec-inlining entry) presents the non-index runIteration iteration as a live or candidate path; both record that non-index specs are blocked at preflight and never reach the agent loop.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: correct both non-index runIteration entries — the `[v2-cleanup candidate]` block and the separate non-index subspec-inlining entry — to reflect the removed path (this subspec changes existing v1 behavior, so the parity baseline must be updated).

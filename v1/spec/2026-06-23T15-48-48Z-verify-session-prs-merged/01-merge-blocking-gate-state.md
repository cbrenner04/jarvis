# Merge-blocking gate state on outstanding entries

## Behavior

Each outstanding entry in the no-arg `jarvis1 triage` session-end verdict reports GitHub's merge-blocking gate state when GitHub provides it, so a PR blocked by failing or pending checks is visibly distinct from one cleared to merge. When GitHub does not report a gate state (no PR, query failure, checks absent), the entry marks it unavailable and the sweep still completes for every worktree.

## Decisions

- Enrich only outstanding entries with gate state — landed worktrees need no action, so rules out an extra gh query per landed worktree.
- Source the gate state from GitHub's merge-state fields (e.g. `mergeStateStatus`/`statusCheckRollup` on `gh pr view`); the implementer picks the field that reflects merge-blocking, surfaced verbatim — rules out triage inventing its own pass/fail rollup from raw check rows.
- A missing or failed gate query degrades to an "unavailable" marker and never aborts the sweep — rules out one unreachable PR blanking the verdict for the rest.

## Task checklist

- Extend the outstanding-entry rendering in `v1/src/commands/triage.ts` to fetch and display GitHub's merge-blocking gate state.
- Handle the unavailable case (no PR / query failure / no checks) with an explicit marker, not a thrown error.
- Add tests to `v1/test/triage-command.test.ts` covering blocked, clear, and unavailable gate states.
- Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] An outstanding entry whose PR GitHub reports as merge-blocked shows a gate state distinct from one GitHub reports as clear.
- [ ] An outstanding entry with no PR, a failed gate query, or no reported checks shows an explicit "unavailable" gate state.
- [ ] A gate-state query failure on one outstanding worktree does not abort the sweep; remaining worktrees still appear in the verdict.
- [ ] The all-landed verdict and the existing summary table are unchanged by gate-state reporting; pre-existing `v1/test/triage-command.test.ts` tests stay green.
- [ ] `v2/docs/v1-behaviors.md` describes the merge-blocking gate state reported on outstanding entries and the unavailable fallback.

## Documentation updates

- `v2/docs/v1-behaviors.md` — merge-blocking gate state on outstanding triage entries and the unavailable fallback.

# Scoped abandon in suggested moves

## Problem

Named triage drill-down (`jarvis1 triage <worktree-name>`) ends rule 6 and the
fallback with raw `git` discard steps or generic inspect text. Operators must
translate eligibility into `jarvis1 cleanup --abandon <worktree-name>` themselves.

## Prerequisites

- Merged scoped-abandon cleanup: `jarvis1 cleanup --abandon <worktree-name>` retires one named eligible worktree without scanning unrelated worktrees.

## Behavior

Extend named-form **Suggested next moves** so eligible worktrees name the scoped
abandon command. Suggestions remain advisory text only; triage executes nothing.

**Drill-down context.** `triageDrillDown` already has `worktreeName` and
`projectRoot`. Thread both into `renderSuggestedMoves` and
`buildSuggestedMovesInput` (today `renderSuggestedMoves` takes only
`worktreePath`). `worktreeName` is the operator-facing scoped-command token;
do not derive it from path basename.

**Eligibility.** Export one shared scoped-abandon preflight helper consumed by
cleanup scoped abandon and triage suggested-moves — the same composite
`scopedAbandonCleanup` enforces before acting:

1. worktree path exists under `projectRoot`
2. no live `.jarvis.lock` (stale ignored)
3. branch resolves via `branchForWorktree`
4. `checkAbandonPrEligibility` outcome is `eligible`

Any step failure → not eligible (conservative). Triage must not call only the PR
helper.

`buildSuggestedMovesInput` invokes the shared helper with `projectRoot`,
`worktreeName`, and `worktreePath`; result becomes `scopedAbandonEligible` on
`SuggestedMovesInput` alongside `worktreeName`.

**Rule table** (first match wins; rules 1–5 unchanged; rule 7 inserts after
rule 6, before existing fallback):

6. `modified` or `mixed` + `specComplete = false` (unchanged match):
   - Keep inspect and resume lines when today.
   - Discard line: when `scopedAbandonEligible`, emit
     `Discard: jarvis1 cleanup --abandon <worktree-name>`; else keep
     `Discard: git -C <path> reset --hard && git -C <path> clean -fd`.

7. `clean` + `specComplete = false` + `prState ∈ {CLOSED, none}` +
   `scopedAbandonEligible`:
   - `1. Retire this worktree: jarvis1 cleanup --abandon <worktree-name>`

`clean` + incomplete + `prState ∈ {DRAFT, OPEN}` stays on fallback even when
abandon-eligible — draft/open PR implies resume, not triage abandon.

Fallback and all other unmatched shapes unchanged.

**Non-goals.** No global `jarvis1 cleanup --abandon` suggestion. No abandon line
when merged cleanup (rules 2/4), push (rule 1), seed-spec (rule 3), or finalize
commit (rule 5) is the winning rule. No abandon when `prState = unknown` or
eligibility is false.

## Decisions

- Suggest scoped `jarvis1 cleanup --abandon <worktree-name>` only — rules out global abandon preview in triage output.
- Gate on the full scoped-abandon preflight composite cleanup refuses — rules out triage calling only `checkAbandonPrEligibility` and drifting on lock/branch guards.
- Single shared eligibility export for cleanup and triage — rules out parallel eligibility tables.
- `worktreeName` and `projectRoot` pass from drill-down into suggested-moves builders — rules out path-basename derivation or recomputing project root inside `buildSuggestedMovesInput`.
- `prState = unknown` or failed PR inspection → not eligible — rules out destructive suggestions under uncertain PR state.
- Rule 6 keeps resume before abandon discard; no resume suppression without an objective irreconcilable classifier — rules out triage dropping resume on dirty incomplete trees (closes intent deferral for dirty shapes).
- Rule 6 discard label stays `Discard:` with scoped command substituted — rules out inconsistent operator copy vs rule 7 `Retire this worktree:`.
- Rule 6 replaces only the git reset/clean discard line when eligible — rules out dropping resume while still offering raw git teardown.
- Rule 7 after rule 6, before fallback — rules out ambiguous precedence vs fallback.
- Rule 7 covers `clean` + incomplete + `{CLOSED, none}` + eligible only — rules out abandon suggestions on `clean` + incomplete + `{DRAFT, OPEN}` despite cleanup eligibility.
- Rules 1–5 ordering and match predicates unchanged — rules out regressing push/merged-cleanup/finalize/seed-spec suggestions.

## Tasks

- [ ] Export shared scoped-abandon preflight helper (exists, live lock, branch resolve, `checkAbandonPrEligibility`); wire cleanup scoped abandon through it.
- [ ] Thread `worktreeName` + `projectRoot` from `triageDrillDown` into `renderSuggestedMoves` / `buildSuggestedMovesInput`.
- [ ] Extend `SuggestedMovesInput`, `buildSuggestedMovesInput`, and `renderSuggestedMoves` with `worktreeName` + `scopedAbandonEligible` from the shared helper.
- [ ] Update rule 6 discard branch and insert rule 7 after rule 6 in `v1/src/commands/triage.ts`.
- [ ] Unit tests in `v1/test/triage-command.test.ts`: shared eligibility derivation (eligible, merged PR, ready open PR, multiple open PRs, live lock, PR inspection failure, branch resolution failure); eligible/ineligible rule 6; rule 7; `clean` + incomplete + `DRAFT`/`OPEN` stays fallback; preservation of rules 1–5, unknown-`prState`, merged paths.
- [ ] Update `v2/docs/v1-behaviors.md` suggested-moves delta (see Documentation updates).

## Acceptance criteria

- [ ] Shared scoped-abandon preflight returns eligible for a passing composite and ineligible for merged PR, ready open PR, multiple open PRs, live lock, PR inspection failure, and branch resolution failure (`triage-command.test.ts` eligibility derivation tests).
- [ ] Rule 6 on an eligible incomplete dirty worktree includes `Discard: jarvis1 cleanup --abandon <worktree-name>` and still includes a resume line when `specPath` is set.
- [ ] Rule 6 on the same shape when not abandon-eligible keeps `Discard: git -C <path> reset --hard && git -C <path> clean -fd` and omits scoped abandon.
- [ ] Rule 7 on `clean` + incomplete + `prState` `CLOSED` or `none` + eligible emits only `Retire this worktree: jarvis1 cleanup --abandon <worktree-name>` (no resume line).
- [ ] `clean` + incomplete + `prState` `DRAFT` or `OPEN` + abandon-eligible falls through to fallback (no scoped abandon).
- [ ] `triage-command.test.ts` suggested-moves rule 1–5 tests stay green.
- [ ] `triage-command.test.ts` `fallback suggestion includes diff and session log` and `untracked-only with MERGED (no spec path) falls through to fallback` tests stay green.
- [ ] `prState = unknown` never emits scoped abandon (`triage-command.test.ts` unknown-prState tests stay green).
- [ ] No suggested-moves line contains bare `jarvis1 cleanup --abandon` without `<worktree-name>`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — named triage suggested-moves delta:
  - eligibility gate matches scoped-abandon preflight (exists, live lock, branch, PR guards);
  - rule 6 substitutes scoped abandon on the `Discard:` line when eligible, resume retained;
  - rule 7: `clean` + incomplete + `{CLOSED, none}` + eligible → single `Retire this worktree:` scoped abandon line;
  - no global `jarvis1 cleanup --abandon` suggestion.

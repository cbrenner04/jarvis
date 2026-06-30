# Scoped abandon in suggested moves

## Problem

Named triage drill-down (`jarvis1 triage <worktree-name>`) ends rule 6 and the
fallback with raw `git` discard steps or generic inspect text. Operators must
translate eligibility into `jarvis1 cleanup --abandon <worktree-name>` themselves.

## Behavior

Extend named-form **Suggested next moves** so eligible worktrees name the scoped
abandon command. Suggestions remain advisory text only; triage executes nothing.

**Eligibility input.** `buildSuggestedMovesInput` gains `worktreeName` and
`scopedAbandonEligible`, computed with the same guards scoped cleanup enforces:
not merged PR, at most one matching open PR and it is draft when present, PR
inspection succeeds, branch resolves, no live `.jarvis.lock` (stale lock ignored).
Any inspection failure or ambiguous PR state → not eligible (conservative).

**Rule table changes** (first match still wins; rules 1–5 unchanged):

6. `modified` or `mixed` + `specComplete = false` (unchanged match):
   - Keep inspect and resume lines when today.
   - Discard line: when `scopedAbandonEligible`, emit
     `jarvis1 cleanup --abandon <worktree-name>`; else keep
     `git -C <path> reset --hard && git -C <path> clean -fd`.

7. `clean` + `specComplete = false` + `prState ∈ {CLOSED, none}` +
   `scopedAbandonEligible`:
   - `1. Retire this worktree: jarvis1 cleanup --abandon <worktree-name>`

Fallback and all other unmatched shapes unchanged.

**Non-goals.** No global `jarvis1 cleanup --abandon` suggestion. No abandon line
when merged cleanup (rules 2/4), push (rule 1), seed-spec (rule 3), or finalize
commit (rule 5) is the winning rule. No abandon when `prState = unknown` or
eligibility is false.

## Decisions

- Suggest scoped `jarvis1 cleanup --abandon <worktree-name>` only — rules out global abandon preview in triage output.
- Gate on the same eligibility predicate scoped cleanup refuses — rules out naming a command cleanup would reject.
- Share or extract scoped abandon eligibility from cleanup (not a parallel rule table) — rules out triage/cleanup drift on PR/lock guards.
- `prState = unknown` or failed PR inspection → not eligible — rules out destructive suggestions under uncertain PR state (parity with existing unknown guard).
- Rule 6 keeps resume before abandon discard — rules out replacing resume with abandon on incomplete dirty trees.
- Rule 6 replaces only the git reset/clean discard line when eligible — rules out dropping resume while still offering raw git teardown.
- New rule 7 covers clean + incomplete + `{CLOSED, none}` + eligible — rules out leaving those shapes on generic fallback when abandon is the salvage move.
- Rules 1–5 ordering and match predicates unchanged — rules out regressing push/merged-cleanup/finalize suggestions.
- `renderSuggestedMoves` receives `worktreeName` from drill-down context — rules out re-deriving basename from path heuristics.

## Tasks

- [ ] Extract or export scoped abandon eligibility helper shared by cleanup and triage (`v1/src/commands/cleanup.ts`, new shared module, or equivalent).
- [ ] Extend `SuggestedMovesInput`, `buildSuggestedMovesInput`, and `renderSuggestedMoves` with `worktreeName` + `scopedAbandonEligible`.
- [ ] Update rule 6 discard branch and add rule 7 in `v1/src/commands/triage.ts`.
- [ ] Unit tests in `v1/test/triage-command.test.ts` for eligible/ineligible rule 6, rule 7, and preservation of rules 1–5 / unknown-prState / merged paths.
- [ ] Update `v2/docs/v1-behaviors.md` triage suggested-moves entry.

## Acceptance criteria

- [ ] Rule 6 on an eligible incomplete dirty worktree includes `jarvis1 cleanup --abandon <worktree-name>` on the discard line and still includes a resume line when `specPath` is set.
- [ ] Rule 6 on the same shape when not abandon-eligible (merged PR, ready open PR, multiple open PRs, live lock, or PR inspection failure) keeps the existing `reset --hard` / `clean -fd` discard line and omits scoped abandon.
- [ ] Rule 7 on `clean` + incomplete + `prState` `CLOSED` or `none` + eligible emits only the scoped abandon suggestion (no resume line).
- [ ] Winning rules 1–5 output is unchanged (`triage-command.test.ts` existing suggested-moves rule 1–5 tests stay green).
- [ ] `prState = unknown` never emits scoped abandon (`triage-command.test.ts` unknown-prState tests stay green).
- [ ] No suggested-moves line contains bare `jarvis1 cleanup --abandon` without `<worktree-name>`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — named triage suggested-moves includes scoped abandon when eligible; rule 6 discard substitution and rule 7 clean/incomplete salvage.

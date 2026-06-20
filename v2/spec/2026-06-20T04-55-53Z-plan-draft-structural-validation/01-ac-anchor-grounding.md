# Behavioral/preservation AC anchor grounding

## Problem

Structural validation (subspec 00) catches malformed ACs but not a well-formed AC that contradicts real behavior. The `shared-invocation-executor` spec shipped an AC asserting plan stops on a hard error while `plan-draft-hard-error-continue.test.ts` proved the opposite. The contradiction was invisible because the AC paraphrased behavior instead of citing the test that pins it.

This subspec enforces the [[refactor-acs-cite-tests]] convention at draft time: a behavioral/preservation AC must cite an existing test or source anchor. The check is the deterministic half (anchor present/absent); judging whether a cited test actually contradicts the claim stays agent discipline.

## Decisions

- Trigger only behavioral/preservation ACs — those containing a preservation/continuation verb ("preserved", "unchanged", "stops", "continues", "stays", "remains"). Coarse trigger set pinned at implementation. Rules out flagging every AC.
- An "anchor" is a reference to an existing test or source file/symbol (e.g. a `*.test.ts` path or backtick-wrapped source path). Detection is deterministic present/absent. Rules out semantic verification of the cited test here — that stays agent discipline and the patch-rules backstop (separate spec).
- Missing-anchor behavioral AC → **warning** (non-blocking; surfaced on stderr, draft still commits). Rationale: coarse keyword trigger risks false positives on genuinely new behavior; the operator reviews on the draft PR and the implementation-side guardrail is the hard backstop. Rules out fail.
- Builds on the non-blocking `warnings` channel added to `validateDraftOutput` in subspec 00. Rules out a second warning surface.

Coarse trigger verb set and anchor-pattern: exact forms pinned at implementation.

## Task checklist

- [ ] Add a behavioral/preservation-AC detector and anchor-presence check (helper over parsed ACs from `shared/spec-parser.ts`).
- [ ] Wire it into `validateDraftOutput` as a warning source on the `warnings` channel.
- [ ] Add tests covering: trigger AC without anchor (warns), trigger AC with anchor (silent), non-trigger AC (silent), and that the draft still commits.

## Acceptance criteria

- [ ] A behavioral/preservation AC with no test or source anchor (e.g. "plan stops on a hard error") produces a non-blocking warning on stderr; the draft still commits.
- [ ] The same AC carrying a test or source anchor (e.g. "`plan-draft-hard-error-continue.test.ts` stays green") produces no anchor warning.
- [ ] An AC with no preservation/continuation trigger verb produces no anchor warning regardless of anchors.
- [ ] The anchor check never sets `valid: false` — it only warns.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: draft-validation section — note the behavioral/preservation-AC anchor warning enforcing the cite-a-test convention.
- `v2/docs/v1-behaviors.md`: record the anchor-grounding warning as part of draft validation behavior.

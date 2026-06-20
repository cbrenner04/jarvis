# Behavioral/preservation AC anchor grounding

## Problem

Structural validation (subspec 00) catches malformed ACs but not a well-formed AC that contradicts real behavior. The `shared-invocation-executor` spec shipped an AC asserting plan stops on a hard error while `plan-draft-hard-error-continue.test.ts` proved the opposite. The contradiction was invisible because the AC paraphrased behavior instead of citing the test that pins it.

This subspec enforces the [[refactor-acs-cite-tests]] convention at draft time: a behavioral/preservation AC must cite an existing test or source anchor. The check is the deterministic half (anchor present/absent); judging whether a cited test actually contradicts the claim stays agent discipline. The `refactor-acs-cite-tests` convention has no shipped durable definition (it exists only as a raw-seed wip-intent), so **this subspec is the authoritative source** of its machine-checkable trigger-verb set and anchor rule, pinned below.

## Decisions

- Ordered dependency: this subspec builds on the non-blocking `warnings` channel introduced in subspec 00 and is **not independently landable** — it lands after 00. Rules out a second warning surface and out-of-order implementation.
- Trigger verb set (authoritative, pinned here): a behavioral/preservation AC is one whose text contains a preservation/continuation verb — `preserved`, `unchanged`, `stays`, `remains`, `stops`, `continues` (case-insensitive, whole-word). Rules out flagging every AC and out of leaving the set to implementation.
- Anchor pattern (authoritative, pinned here): an anchor is a **path-like reference** — a `*.test.ts` filename/path, or a backtick span containing a path separator or a source-file extension (e.g. `` `v1/src/commands/plan.ts` ``). A plain backtick span with no path shape (e.g. `` `patch_phase: "shrink"` ``) is **not** an anchor. Rules out treating any backtick span as an anchor, which would silently suppress warranted warnings — worse than a false warning. Detection is deterministic present/absent; semantic verification of the cited test stays agent discipline and the patch-rules backstop (separate spec).
- Missing-anchor behavioral AC → **warning** (non-blocking; surfaced on stderr, draft still commits). Rationale: coarse keyword trigger risks false positives on genuinely new behavior; the operator reviews on the draft PR and the implementation-side guardrail is the hard backstop. Rules out fail.

## Task checklist

- [ ] Add a behavioral/preservation-AC detector and anchor-presence check (helper over parsed ACs from `shared/spec-parser.ts`).
- [ ] Wire it into `validateDraftOutput` as a warning source on the `warnings` channel.
- [ ] Add tests covering: trigger AC without anchor (warns), trigger AC with anchor (silent), non-trigger AC (silent), and that the draft still commits.

## Acceptance criteria

- [ ] A behavioral/preservation AC with no test or source anchor (e.g. "plan stops on a hard error") produces a non-blocking warning on stderr; the draft still commits.
- [ ] The same AC carrying a path-like anchor (e.g. "`plan-draft-hard-error-continue.test.ts` stays green") produces no anchor warning.
- [ ] A trigger AC whose only backtick span has no path shape (e.g. "`patch_phase: "shrink"` is preserved") still warns — a non-path backtick span does not count as an anchor.
- [ ] An AC with no preservation/continuation trigger verb produces no anchor warning regardless of anchors.
- [ ] The anchor check never sets `valid: false` — it only warns.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: draft-validation section — note the behavioral/preservation-AC anchor warning enforcing the cite-a-test convention.
- `v2/docs/v1-behaviors.md`: record the anchor-grounding warning as part of draft validation behavior.

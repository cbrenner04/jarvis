# Sentinel-delimited PR-description extraction

## Problem

Both `generatePrDescription` impls (`v1/src/modes/plan/pr.ts`,
`v1/src/modes/patch/pr.ts`) return the agent's entire `result.stdout`, gated
only by `description.includes("Decisions:")`. Conversational preamble emitted
before the real description passes that check and leaks into the PR narrative
(observed: a plan PR body opened with "I'll review the actual spec files on
disk..."). Two prior prompt-only fixes did not hold — prompt instructions alone
can't suppress preamble.

## Decisions

- Enforcement lives in extraction code, not the prompt — rules out a third
  prompt-only attempt that repeats the prior failures.
- Both impls + the single `shared.pr-description` fragment change together —
  rules out fixing one mode and leaving the other leaking.
- Absent/malformed sentinels return `null` (existing fallback to the
  deterministic header) — rules out emitting partial/best-effort narrative on
  malformed output.
- Extracted content is still gated on containing `Decisions:` — rules out
  accepting a well-delimited block that dropped the Decisions section.
- No heuristic preamble stripping — no reliable description/preamble boundary
  exists without explicit delimiters.
- Sentinels are literal tokens the fragment instructs the model to emit and the
  code matches verbatim — rules out regex/fuzzy boundary detection.
- The fragment's revision is bumped so the registry/snapshot contract reflects
  the changed fragment body.

## Out of scope

- Any change to `v1/src/pr.ts` narrative markers, hash-guard, or human-edit
  preservation.
- Reformatting the Description/Decisions shape itself.

## Tasks

- Wrap the authored description in explicit literal sentinel delimiters in
  `prompts/shared/pr-description.md` and bump its `revision`. Instruct the model
  to emit nothing outside the sentinels.
- In both `generatePrDescription` impls, replace the
  whole-stdout-includes-`Decisions:` path with: extract the content strictly
  between the first opening sentinel and the next closing sentinel; return that
  trimmed content only when it is non-empty and contains `Decisions:`;
  otherwise return `null`. Preamble/trailing chatter outside the sentinels is
  discarded.
- Keep plan and patch extraction behavior identical (same sentinel tokens, same
  null conditions).
- Regenerate the rendered PR-description prompt snapshot fixtures so they
  reflect the new fragment body.
- Update unit tests for both `generatePrDescription` impls to cover:
  sentinel-wrapped output yields only the inner block; preamble before the
  opening sentinel is stripped; trailing chatter after the closing sentinel is
  stripped; missing/malformed sentinels yield `null`; well-delimited content
  lacking `Decisions:` yields `null`.

## Acceptance criteria

- [ ] `prompts/shared/pr-description.md` instructs the model to wrap the
      Description + `Decisions:` block in explicit literal sentinel delimiters
      and to emit no content outside them, and its `revision` is greater than
      its prior value.
- [ ] Patch-mode `generatePrDescription`, given agent stdout containing
      conversational preamble before the opening sentinel followed by a
      well-formed sentinel-delimited Description + `Decisions:` block, returns
      only the inner block with no preamble.
- [ ] Plan-mode `generatePrDescription`, given the same shape of input, returns
      only the inner block with no preamble.
- [ ] Both impls discard any text after the closing sentinel.
- [ ] Both impls return `null` when the opening or closing sentinel is absent
      or malformed.
- [ ] Both impls return `null` when the sentinel-delimited content does not
      contain `Decisions:`.
- [ ] The rendered PR-description prompt snapshot fixtures
      (`v1/test/fixtures/prompts/rendered/patch.prompt.pr-description@r1.shared.txt`
      and `…/plan.prompt.pr-description@r1.shared.txt`) match the prompts
      produced from the updated fragment, and the rendered-snapshot test passes.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: in the PR-body narrative-generation
  description, state that the model wraps the Description + `Decisions:` block in
  sentinel delimiters and the harness extracts only the content between them,
  and that absent/malformed sentinels (or extracted content lacking
  `Decisions:`) yield no narrative and fall back to the deterministic header.
- `v2/docs/v1-behaviors.md`: update the two PR-narrative generation entries
  (patch draft-PR generation and plan `updatePlanPrBody` generation) to record
  sentinel-delimited extraction and the malformed/absent → no-narrative
  fallback, keeping the v1 parity baseline accurate.

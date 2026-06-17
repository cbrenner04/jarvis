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
  malformed output. `malformed` = opening sentinel missing, closing sentinel
  missing, or closing appearing before the first opening.
- Extracted content is still gated on containing `Decisions:` — rules out
  accepting a well-delimited block that dropped the Decisions section.
- The `Decisions:` gate stays a `includes("Decisions:")` substring check
  (now over the extracted region, not whole stdout); not tightened to a header
  match — rules out scope creep into Decisions-shape validation, which is
  explicitly out of scope.
- No heuristic preamble stripping — no reliable description/preamble boundary
  exists without explicit delimiters.
- Sentinels are literal tokens the fragment instructs the model to emit and the
  code matches verbatim — rules out regex/fuzzy boundary detection.
- Sentinel tokens are `<<<PR_DESCRIPTION_BEGIN>>>` / `<<<PR_DESCRIPTION_END>>>`
  — reuses the codebase's existing `<<<NAME>>>` injected-data delimiter shape
  (matched by `enforceDelimiterPolicy`), rules out an ad-hoc token improbable in
  prose but unguardable by existing machinery.
- The injected `SPEC_CONTEXT` (both modes) and `INTENT` (plan) values are
  guarded with `enforceDelimiterPolicy` against the chosen tokens before render
  — rules out a spec/intent file whose body literally contains the closing
  sentinel slipping a sentinel into model input and fooling "first opening →
  next closing" extraction (the original untrusted-text-leak bug class, from the
  input side). Guard violation throws inside the existing try/catch, so
  `generatePrDescription` returns `null` and falls back to the deterministic
  header rather than leaking.
- Extraction takes the content between the first opening sentinel and the next
  closing sentinel after it — rules out greedy last-closing matching when a
  stray closing token survives.
- Both step prompts (`patch.prompt.pr-description`, `plan.prompt.pr-description`)
  bump `revision` and their rendered fixtures rename `@r1` → `@r2` — the
  snapshot contract keys on the step `id`'s rendered bytes (governance:
  "bump `revision` only when rendered output bytes for that `id` change";
  "snapshot keys are `<id>@r<revision>`"), and the step fixtures embed the
  fragment body verbatim, so editing the fragment changes each step's rendered
  bytes. Rules out the mechanically-wrong assumption that bumping only the
  fragment's own `revision` satisfies the snapshot contract (the fragment is
  already `revision: 2` against `@r1` fixtures, proving fixtures do not key on
  the fragment's number).

## Out of scope

- Any change to `v1/src/pr.ts` narrative markers, hash-guard mechanism, or
  human-edit preservation. (The generated-narrative hash now hashes the
  *extracted* block instead of whole stdout — a consequence of changing
  `generatePrDescription`'s return value, intended; `pr.ts` itself is
  unchanged.)
- Reformatting the Description/Decisions shape itself.
- Tightening the `Decisions:` substring gate to a structural/header check.

## Tasks

- In `prompts/shared/pr-description.md`, instruct the model to wrap the
  Description + `Decisions:` block in literal `<<<PR_DESCRIPTION_BEGIN>>>` /
  `<<<PR_DESCRIPTION_END>>>` sentinels and to emit no content outside them. Bump
  the fragment `revision`.
- In both `pr-description-prompt.ts` builders, guard the injected
  `SPEC_CONTEXT` (and plan's `INTENT`) values with `enforceDelimiterPolicy`
  against the two sentinel tokens before/at render so injected file bodies
  cannot smuggle a sentinel into model input.
- In both `generatePrDescription` impls, replace the
  whole-stdout-includes-`Decisions:` path with: locate the first opening
  sentinel and the next closing sentinel after it; extract the content strictly
  between them; return that trimmed content only when it is non-empty and
  contains `Decisions:`; otherwise return `null`. Preamble before the opening
  sentinel and chatter after the closing sentinel are discarded.
- Keep plan and patch extraction behavior identical (same sentinel tokens, same
  null conditions, same first-opening/next-closing rule).
- Bump both step prompts' (`patch.prompt.pr-description`,
  `plan.prompt.pr-description`) `revision` to `2`, regenerate the rendered
  fixtures under the `@r2` names, delete the stale `@r1` fixtures, and update the
  snapshot generator script (`scripts/generate-pr-description-snapshots.ts`)
  hardcoded filenames and the rendered-snapshot test
  (`v1/test/prompts/rendered-snapshots.test.ts`) revision assertions and fixture
  references accordingly.
- Update unit tests for both `generatePrDescription` impls to cover:
  sentinel-wrapped output yields only the inner block; preamble before the
  opening sentinel is stripped; trailing chatter after the closing sentinel is
  stripped; opening present but closing absent → `null`; closing before opening
  → `null`; well-delimited content lacking `Decisions:` → `null`; and the
  body-assembly null path (no leaked preamble).

## Acceptance criteria

- [ ] `prompts/shared/pr-description.md` instructs the model to wrap the
      Description + `Decisions:` block in the literal `<<<PR_DESCRIPTION_BEGIN>>>`
      / `<<<PR_DESCRIPTION_END>>>` sentinels and to emit no content outside them.
- [ ] Patch-mode `generatePrDescription`, given agent stdout containing
      conversational preamble before the opening sentinel followed by a
      well-formed sentinel-delimited Description + `Decisions:` block, returns
      only the inner block with no preamble.
- [ ] Plan-mode `generatePrDescription`, given the same shape of input, returns
      only the inner block with no preamble.
- [ ] Both impls discard any text after the closing sentinel.
- [ ] Both impls return `null` when the opening sentinel is absent, the closing
      sentinel is absent, or the closing sentinel appears before the first
      opening sentinel.
- [ ] Both impls return `null` when the sentinel-delimited content does not
      contain `Decisions:`.
- [ ] When a spec/intent file body fed into `SPEC_CONTEXT` (or plan `INTENT`)
      literally contains a sentinel token, the affected `generatePrDescription`
      returns `null` (guarded) rather than extracting an injected sentinel.
- [ ] On the `null` return, patch mode assembles a header-only PR body (no
      narrative markers, no leaked preamble) and plan mode assembles a body with
      no narrative section — the observable end-to-end body outcome.
- [ ] Both `patch.prompt.pr-description` and `plan.prompt.pr-description` report
      `revision` `2`; the rendered PR-description prompt fixtures are
      `v1/test/fixtures/prompts/rendered/patch.prompt.pr-description@r2.shared.txt`
      and `…/plan.prompt.pr-description@r2.shared.txt`, the prior `@r1` fixtures
      are removed, and the rendered-snapshot test (with its updated revision
      assertions) passes.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: in the PR-body narrative-generation
  description, state that the model wraps the Description + `Decisions:` block in
  the `<<<PR_DESCRIPTION_BEGIN>>>` / `<<<PR_DESCRIPTION_END>>>` sentinels and the
  harness extracts only the content between them, and that absent/malformed
  sentinels (opening or closing missing, or closing before opening), extracted
  content lacking `Decisions:`, or an injected sentinel in spec/intent context
  yield no narrative and fall back to the deterministic header.
- `v2/docs/v1-behaviors.md`: update all four PR-narrative entries — patch
  draft-PR generation, patch PR-body rewrite/regeneration, plan
  `updatePlanPrBody` generation, and plan PR-body rewrite/regeneration — to
  record sentinel-delimited extraction (and the malformed/absent/injected →
  no-narrative deterministic-header fallback), keeping the v1 parity baseline
  accurate for both first-generation and rewrite paths.

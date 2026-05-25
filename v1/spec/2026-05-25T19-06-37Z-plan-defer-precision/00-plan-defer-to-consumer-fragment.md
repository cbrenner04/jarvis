# 00 - plan.defer-to-consumer prompt fragment

## Problem

Plan mode refines, drafts, and reviews specs through non-interactive agent turns
that can only *add* (`## Refine turn N`), idle (`## Refine skip`), or halt
(`## Blocker`). The loop cannot ask the human a question, so genuine ambiguity
gets resolved by invention rather than deferral. With a default budget (3 refine
turns, 2 review passes), the pressure is to spend turns tightening. On a spec
whose first consumer does not exist yet, "more precise" is not "more correct" —
it is more guesswork frozen into the contract.

Concrete failure: the v2 phase-1 state-store spec pinned duplicate-commit
behavior, terminal-run encoding, and a seven-value run-status enum across three
refine turns — none exercised by any caller, because step execution is six
phases out. The loop did its job; it had no instruction to prefer leaving a
decision open.

## Decisions

- Add one shared fragment `prompts/plan/defer-to-consumer.md`, id
  `plan.defer-to-consumer` (frontmatter: behavior `agent-facing`, kind
  `fragment`, revision `1`), mirroring the `global.terse` shape.
- Body states the rule tersely: when authoring a spec for something ahead of its
  first consumer, prefer deferral over invented precision; do not resolve an
  ambiguity by guessing when the answer belongs to the first caller; record such
  decisions as explicit deferral notes inside the normal section
  (`Deferred to first consumer: <decision> — pin when a caller needs it`) rather
  than inventing an answer or escalating to a blocker; precision added to
  behavior no current code exercises is a warning sign, not rigor.
- Wire it into all three plan phases' `globalFragmentIds` in
  `v1/src/modes/plan/refine.ts`, `draft.ts`, and `review.ts` (alongside
  `global.documentation`, `global.terse`). Refine originates the invention;
  draft concretizes it into acceptance criteria; review re-pins what refine
  deferred — the brake must sit in all three.
- Register the new path in `v1/src/prompts/registry.ts` `PROMPT_ARTIFACT_FILES`.
- No change to refine validation or permitted section types. Deferrals are
  recorded as notes within the existing `## Refine turn N` / draft / review
  output; the loop's section grammar is untouched.
- Scope to plan mode only. Do not wire into patch's `globalFragmentIds`: patch
  implements against an existing spec and repo, where the consumer exists and
  deferral is wrong advice.
- Adding a fragment changes three rendered plan prompts, which are
  snapshot-governed. Bump `plan.prompt.refine`, `plan.prompt.draft`, and
  `plan.prompt.review` revisions and regenerate their rendered fixtures per the
  prompt-governance standard.

## Non-goals

- The patch-side analog — "do not model states, columns, or enum values with no
  caller" — is code-craft YAGNI, a separate fragment for patch mode. Out of
  scope here; do not conflate.
- No new refine outcome/section type, no change to `--refine-turns` /
  `--review-passes` defaults, no change to the interactive/non-interactive
  boundary.

## Tasks

- [x] Create `prompts/plan/defer-to-consumer.md` with fragment frontmatter and body.
- [x] Register the new path in `v1/src/prompts/registry.ts`.
- [x] Add `plan.defer-to-consumer` to `globalFragmentIds` in
  `v1/src/modes/plan/refine.ts`, `draft.ts`, and `review.ts`.
- [x] Bump revisions for `plan.prompt.refine`, `plan.prompt.draft`,
  `plan.prompt.review`; regenerate the rendered-prompt fixtures under
  `v1/test/fixtures/prompts/rendered/` (including the per-pass review variants).
- [x] Update revision assertions in `v1/test/prompts/rendered-snapshots.test.ts`.
- [x] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [x] `prompts/plan/defer-to-consumer.md` exists with id `plan.defer-to-consumer`
  and loads via the prompt registry.
- [x] Rendered refine, draft, and review prompts include the deferral rule text.
- [x] The patch prompt does not include the fragment.
- [x] Rendered-prompt snapshot tests pass against regenerated, revision-keyed
  fixtures for all three plan phases.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- If `v1/docs/plan-mode.md` or a prompt-governance doc enumerates the global
  fragment set per phase, add `plan.defer-to-consumer` there. No new standalone
  doc.

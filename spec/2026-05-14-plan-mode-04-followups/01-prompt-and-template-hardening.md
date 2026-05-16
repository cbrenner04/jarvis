# 01 — Prompt and template hardening

## Problem

Several review notes on PR #30 flagged small but real footguns in the
plan-mode prompt templates and the way they are interpolated. None of
them are correctness bugs today, but each one increases the chance that
a future agent or future template edit silently does the wrong thing.

The relevant review items are:

- **#3** — `buildDraftPrompt` and `buildReviewPrompt` use plain string
  `replaceAll` over `<INTENT>`, `<SPEC_GUIDANCE>`, `<NAME>`, `<WORKDIR>`,
  and `<CURRENT_SPEC>`. If user intent ever literally contains the
  string `<SPEC_GUIDANCE>` (or any other placeholder), the resulting
  prompt will be silently corrupted. We currently rely on intent text not
  containing those placeholders by accident.
- **#5** — The draft prompt names the file `intent.md` only inside the
  rules, not next to the `<<<INTENT_BEGIN>>>` block itself. An agent
  scanning the prompt for "what file is this?" can miss the answer.
- **#6** — The review prompt's `## Current spec` section does not name
  the worktree path; the agent must infer it from `<WORKDIR>` mentioned
  earlier. This is fine today but brittle.
- **#10** — `snapshotSpecFiles` in `src/modes/plan/review.ts` produces a
  flat `<<<FILE name="..." BEGIN>>>` block per file but does not order
  files deterministically across platforms (it depends on `readdirSync`
  ordering).

## Decisions

- **Replace placeholder substitution with a pass that errors on
  collisions.** Before substituting, scan each value for any of the
  recognized placeholder tokens and refuse to build the prompt if a
  collision is detected. The error message names the offending field
  (e.g. "intent text contains the literal token `<SPEC_GUIDANCE>`; this
  would corrupt the prompt"). The harness should treat this as a fatal
  configuration error (exit `3`, matching the existing `model_config`
  category in `src/modes/patch/run.ts`).
- **Name the file inside the data block paragraph.** Update
  `src/modes/plan/prompts/draft.md` so the paragraph that introduces
  `<<<INTENT_BEGIN>>>` says "the user-supplied content of
  `spec/<NAME>/intent.md`" explicitly. Same for the review prompt's
  intent block.
- **Sort spec files deterministically.** `snapshotSpecFiles` must sort
  the directory listing with locale-independent string comparison
  (`Intl.Collator("en", { sensitivity: "variant" })` or equivalent)
  before iterating. Add a regression test that constructs a directory
  with files written in non-sorted order on disk and asserts the
  snapshot lists them sorted.

## Acceptance criteria

- [x] `buildDraftPrompt` and `buildReviewPrompt` throw a typed error
  when any input value contains a placeholder token; the error names
  the offending field.
- [x] The plan-mode entry point in `src/commands/plan.ts` catches that
  error and exits `3` with a stderr message describing the collision.
- [x] The draft and review prompt templates name the file
  (`spec/<NAME>/intent.md`) inside the paragraph that introduces the
  `<<<INTENT_BEGIN>>>` block.
- [x] `snapshotSpecFiles` returns files in deterministic sorted order;
  a new test in `test/modes/plan/review.test.ts` writes files in
  reverse order on disk and asserts ascending order in the snapshot.
- [x] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- Update `docs/plan-mode.md` "Phases — Draft" and "Phases — Self-review"
  subsections to mention that placeholder collisions are a fatal
  configuration error and exit code `3`.
- No changes to `README.md`, `AGENTS.md`, or `docs/spec-guidance.md`.

# Failing-test AC requirement in draft prompt and spec guidance

Plan-drafted subspecs today carry criteria satisfiable by reading the code, so runs land runtime
behavior with zero tests and a green gate. Make the failing-test criterion a drafting rule.

## Decisions

- The rule ships in two places: a rule bullet in `prompts/plan/draft.md` and a subsection under
  `## Behavioral acceptance criteria` in `v1/docs/spec-guidance.md` — the doc is read at runtime by
  `v1/src/modes/plan/draft.ts`, `review.ts`, and `verdict-actuator.ts`, so review and actuator passes
  inherit it without editing three prompts. Alternative ruled out: prompt-only, which leaves the
  review pass blind to the rule.
- Rule text: every subspec changing runtime behavior carries an acceptance criterion naming a test
  that fails against the pre-fix code and passes after the change; "existing tests stay green" does
  not satisfy it; docs-only and spec-only subspecs are exempt.
- No draft-time validator check (`shared/spec-parser.ts`) — prompt/doc only. Ruled out: a new warning
  kind, which is mechanical enforcement the intent puts out of scope.
- `prompts/plan/draft.md` `revision` bumps to 10; the rendered snapshot fixture moves to
  `plan.prompt.draft@r10.shared.txt`.

## Acceptance criteria

- [x] The rendered plan-draft prompt (`buildDraftPrompt`) instructs the drafting agent that every
      subspec changing runtime behavior must carry an acceptance criterion naming a test that fails
      against the pre-fix code and passes after the change, that "existing tests stay green" does not
      satisfy it, and that docs-only/spec-only subspecs are exempt.
- [x] A new assertion in `v1/test/modes/plan/prompts.test.ts` fails against the pre-change prompt and
      passes after it, covering the requirement above.
- [x] `v1/docs/spec-guidance.md` § Behavioral acceptance criteria states the failing-test requirement
      with the `blocked-run-retains-worktree-and-branch` regression criterion as the worked example,
      and is reachable by plan review and verdict-actuator passes (they inject the same doc).
- [x] `plan.prompt.draft` revision is bumped and the rendered-snapshot suite
      (`v1/test/prompts/rendered-snapshots.test.ts`) is green against the new fixture.

## Documentation updates

- `v1/docs/spec-guidance.md` — new subsection under `## Behavioral acceptance criteria` stating the
  requirement, the exemption, and the worked example.
- `v2/docs/v1-behaviors.md` — record that plan draft now requires a failing-test AC for
  runtime-behavior subspecs (existing plan-draft behavior changes).
- `v1/docs/prompt-governance.md` — only if the revision-bump listing there needs it.

## Out of scope

- Mechanical enforcement (diff-coverage gate, validator warning kind).

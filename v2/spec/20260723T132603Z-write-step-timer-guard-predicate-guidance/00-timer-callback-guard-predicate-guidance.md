# 00 - Timer-callback guard predicate guidance in implement prompt

## Problem

Inline guards inside `setTimeout`/`setInterval` callbacks stall implement runs: mutation
verification demands both-direction kill tests on changed lines, while the determinism guard
forbids the obvious real-timer test in agent-runnable daemon/execution suites. Agents see
neither constraint together and leave the guard inline.

## Decisions

- Rule lives in `prompts/patch/rules.md` (`patch.rules`), phrased target-repo-agnostic — rules out jarvis-only `REPO_GUIDANCE` injection or verifier/guard changes.
- Bump `patch.rules` and `patch.prompt.body` revisions with new rendered fixtures — rules out editing already-shipped snapshot fixtures in place.
- Pin via a v2 test on rendered `patch.prompt.body` content — rules out doc-only guidance or snapshot revision bumps without a content assertion.
- `v2/docs/test-writing.md` § Deterministic daemon and execution tests carries the durable rule line — rules out operator-runbook edits (sibling intent) and the worked example (fixture intent).
- Prompt/rule change only — rules out exempting timer-callback lines from mutation or allowing real timers in determinism-guarded suites.
- Land after `20260723T132247Z-timer-callback-guard-extraction-fixture` merges — rules out parallel implementation on the pre-fix seam.

## Task checklist

- [ ] Add one terse rule to `prompts/patch/rules.md` (`patch.rules`): when a guard sits inside a
      `setTimeout` or `setInterval` callback, extract it into a pure exported predicate and test
      both truth directions directly without a real-timer wait.
- [ ] Bump `patch.rules` `revision`; bump `patch.prompt.body` `revision` in
      `prompts/patch/instructions.md`.
- [ ] Add `patch.prompt.body@r<n>` shared (+ codex-wrapper if required) fixtures under
      `v1/test/fixtures/prompts/rendered/`; update revision assertions in
      `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Add a `write.test.ts` case that renders `patch.prompt.body` through `executeWrite` and
      asserts the rule sentence is present.
- [ ] Add the matching rule line to `v2/docs/test-writing.md` § Deterministic daemon and
      execution tests.

## Acceptance criteria

- [ ] `write.test.ts` asserts the rendered implement write-step prompt (`patch.prompt.body` via
      `executeWrite`) instructs extracting a guard inside a `setTimeout` or `setInterval`
      callback into a pure exported predicate testable in both directions without a real timer;
      the test fails against the pre-fix prompt.
- [ ] `v2/docs/test-writing.md` § Deterministic daemon and execution tests states that
      timer-callback guards must be extracted into pure predicates so mutation verification and
      the determinism guard are both satisfiable.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` passes against fixtures keyed at the bumped
      `patch.prompt.body` revision.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` stays green.
- [ ] `scripts/guard-deterministic-daemon-tests.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` § Deterministic daemon and execution tests — extract timer-callback
  guards into pure predicates so mutation verification and the determinism guard are both
  satisfiable.

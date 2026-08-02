---
name: mutation-checkpoint-verifier-skips-directive-only-criteria
---

# A criterion that quotes a `@mutate` directive but omits the phrase is never verified

## Problem

`verifyMutationCheckpoints` selects criteria by literal phrase:

```ts
criterion.text.includes(CRITERION_MARKER)   // "Mutation checkpoint:"
// v2/src/execution/mutation-checkpoint-verifier.ts:70, :251-254
```

A criterion that names the machine contract directly — *"`…test.ts` carries
`// @mutate <path> "<old>" -> "<new>"`; its pin fails under that mutation"* — contains the
directive but not the phrase, so it is filtered out and the checkpoint is **never applied**. The
tick is accepted on the agent's word, which is exactly the failure #2502 shipped to close.

Observed on `20260802T034130Z-pipeline-list-detail-fields` (#2511): two directive-quoting criteria,
`verifyMutationCheckpoints` returned empty, the run went green, and both mutations were only proven
to kill by a reviewer applying them by hand afterwards. The seed and every intent split from it
carried the same phrasing, so this reproduces on the next spec in the same queue unless fixed.

The silence is the defect. An unparseable directive is reported on stderr; a directive the selector
never looks at produces nothing at all.

## Decisions

- Select a criterion for verification when it contains **either** `Mutation checkpoint:` **or** a
  `@mutate` directive reference (`DIRECTIVE_MARKER` already exists in the file) — rules out asking
  every future spec author to remember one exact phrase, which is what failed here.
- A criterion selected by directive reference is held to the same contract as a phrase-marked one:
  the linked directive must resolve, apply, and turn the scoped suite red, or the tick is refused —
  rules out a weaker second class of checkpoint.
- Out of scope: changing the directive syntax, the resolution rules, or the phrase-marked path's
  behavior; the untimed/unabortable scoped verification run (already named in the runbook).

## Acceptance criteria

- [ ] A ticked criterion whose text quotes `// @mutate …` but never says `Mutation checkpoint:` is
      verified: with a directive that leaves the suite green the tick is refused with `path:line`
      coordinates, and with a directive that turns it red the tick is accepted.
- [ ] A ticked criterion saying `Mutation checkpoint:` keeps its current behavior — phrase-only
      prose with no linked directive is still refused; a regression covers it.
- [ ] A ticked criterion that mentions neither the phrase nor a directive is still ignored (no
      false selection from prose containing the word "mutation").
- [ ] Mutation checkpoint: reverting selection to phrase-only turns the directive-only test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — the contract keys on the phrase **or** a quoted
  directive.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — same, for spec authors.

## Prerequisites

- `verifyMutationCheckpoints`, `CRITERION_MARKER`, `DIRECTIVE_MARKER`
  (`v2/src/execution/mutation-checkpoint-verifier.ts`)

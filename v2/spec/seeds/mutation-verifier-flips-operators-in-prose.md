# The mutation verifier applies code operators to markdown prose

## Problem

`isProductionFile` (`v2/src/execution/diff-scan.ts`) excludes tests, `v1/spec/`, `v2/spec/`,
`v1/docs/`, and `v2/docs/` — but **not `prompts/**`**. So prompt templates count as production
source, and the diff-derived mutation verifier applies comparison-operator flips to their prose.

Observed 2026-07-21 on PR #1894, which changed `prompts/patch/review-critic.md`:

```text
survivingMutation: operator-flip: < → >=
survivingMutationSourceFile: prompts/patch/review-critic.md
survivingMutationSourceLine: 24
```

Line 24 is prose: "… the unified diff from `git merge-base <base> HEAD` and
`git diff <mergeBase> HEAD`." The `<` is a placeholder bracket, not a comparison. The verifier
mutated documentation punctuation into `>=base>` and then reported the run
`surviving_mutation_failed`, blocking completion.

The verifier is not wrong that prompt content is behavior — a prompt *is* the instruction the agent
executes, and an unreviewed prompt change genuinely can go unnoticed. It is wrong about the
*operator*: `<` in markdown is punctuation, so a comparison flip produces a mutation no reasonable
test targets, and the only way to clear it is a text assertion aimed at the mutated span.

Left as-is this pushes implementers toward brittle prompt-text assertions written to appease a
nonsense mutation, which is worse coverage than none.

## Decisions

- Do not apply comparison-operator flips to non-code files; the operator set must match the file
  kind. Rules out treating every changed line as if it were TypeScript.
- Keep prompt changes inside the verified surface rather than excluding `prompts/**` wholesale —
  prompts are behavior and a silent prompt regression is a real risk. Rules out the one-line fix of
  adding `prompts/` to `NON_PRODUCTION_PATTERNS`.
- For prompt artifacts, pin behavior at the rendered-output level: a changed prompt should require
  a test that observes the rendered prompt, not a mutation of its characters. Pin the exact
  mechanism in the plan — requiring coverage of the changed template's render is the candidate.
- Classify file kind explicitly (code / prompt / other) rather than as a boolean production flag,
  so future verifiers can pick appropriate operators per kind.

## Acceptance criteria

- [ ] A diff touching only prompt markdown never yields a comparison-operator mutation.
- [ ] A changed prompt template still requires coverage: a prompt change with no test observing its
      rendered output is reported, with a message naming the template.
- [ ] A diff touching TypeScript is mutated exactly as today.
- [ ] The reported failure for an uncovered prompt names the template and the missing render
      coverage, not a character-level mutation.
- [ ] Regression coverage includes the #1894 case: a `<base>` placeholder in prose is never flipped.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — what mutation verification covers per file kind.
- `v2/docs/test-writing.md` — how to cover a prompt change.

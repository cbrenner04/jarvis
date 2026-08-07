# Intent write step lints staged Markdown before finalize

## Problem

The intent write step drafts Markdown under `.jarvis-intent-stage/` on the same finalize seam as the plan write step (01) and finalizes without linting it, so ready-gate `lint:md` is the first reader. This subspec extends the staged-path lint gate to the intent-split path, reusing the runner (00) and reprompt surface (01).

## Prerequisites

- Subspec 00 landed: `lintStagedMarkdown` staged-path runner.
- Subspec 01 landed: `write.staged-markdown-lint-reprompt` prompt, `staged_markdown_lint_reprompt` log event, and the plan-draft lint-gate wiring.
- Intent write step stages Markdown under `.jarvis-intent-stage/` before landing (`write-loop.ts` `MARKDOWN_STAGING_ROOTS`, `write-loop-intent-landing.test.ts`); intent split runs autofix before shape/landing-contract checks.

## Decision ledger

- Run the 00 staged-path lint on the `intent.prompt.split` `complete` outcome, after the landing-contract gate passes — rules out plan-only coverage.
- Landing-contract and staged-Markdown lint share `maxIterations` and one reprompt slot per iteration; landing-contract is evaluated first; at most one reprompt per iteration — rules out double reprompt or independent budgets.
- Reuse the 01 reprompt surface (`write.staged-markdown-lint-reprompt` + `staged_markdown_lint_reprompt`) and the same preserve-stage lifecycle and `landing_failed` budget-exhaustion settlement — rules out a second divergent reprompt path.
- Use a unique guard line for the intent-split path as the `@mutate` anchor, distinct from the plan-draft anchor (01) — rules out an ambiguous shared mutation target.
- Out of scope: the plan write-step gate (01); the shared runner (00); changes to the `lint:md` rule set.

## Work

- In `write-loop.ts`, evaluate the 00 lint runner on `intent.prompt.split` `complete` after the landing-contract gate; on violation reprompt within the shared `maxIterations`; on budget exhaustion settle `landing_failed` resumable with stage preserved.
- Wire the 01 reprompt prompt into `write.ts` intent-split path (preserve populated stage; inject reprompt prompt).
- Extend `v2/src/execution/write-loop-staged-markdown-lint.test.ts` with intent cases (violation fixture uses `MD038`, which survives intent autofix; `MD012` is not a valid intent fixture).

## Acceptance criteria

- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step staged Markdown lint violation reprompts before finalize` drives an intent write with a staged `MD038` violation (post-autofix state), asserts a reprompt with rule id and file path before finalize, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step clean staged Markdown finalizes without extra invocation` asserts one agent invocation and finalize on clean intent staging; fails against pre-fix code if a second lint-only invocation runs.
- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step landing-contract reprompt takes precedence over staged Markdown lint` drives an intent write violating both and asserts a single reprompt per iteration with the landing-contract miss reported first.
- [ ] Mutation checkpoint: in `write-loop-staged-markdown-lint.test.ts`, the test titled `intent write step staged Markdown lint violation reprompts before finalize` carries a `// @mutate` directive (inside the test body) on the intent-split lint guard line in `write-loop.ts`; the mutation turns that test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent write step lints staged Markdown before finalization; shared reprompt budget with the landing-contract gate.
- `v2/docs/v1-behaviors.md` — record the new pre-finalization lint gate for intent writes.

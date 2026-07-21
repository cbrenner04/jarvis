# The write step never tells the agent which changed lines are uncovered

## Problem

Coverage is wired but unconsumed. `package.json` defines `coverage`, `coverage:v1`, `coverage:v2`,
and `coverage:shared` (all `bun test --coverage`). Nothing runs them: not CI
(`.github/workflows/**` has no `coverage` reference), not the ready gate
(`v2/src/execution/ready-finalize.ts` runs `check`, `typecheck`, tests, `lint:md`), not the write
step. An agent writing code never sees which of its changed lines are unexercised.

The cost is paid later, by the mutation verifier, at the most expensive possible moment. Observed
2026-07-21 across one session — four implement runs stalled `surviving_mutation_failed` after a full
write, review, commit, push, PR, and green ready gate:

| Run | Surviving mutation | Cause |
| --- | --- | --- |
| `cleanup-archives-workflow-specs-in-one-run` | `=== → !==` `cleanup.ts:161` | unreachable `listRuns?.()` fallback, never executed |
| `runtime-smoke-records-discovery-outcomes` | `!== → ===` `write-loop.ts:215` | negative case never asserted |
| `workflow-command-reports-terminal-workflow-failure` | `!== → ===` `run.ts:28` | new `run list` columns rendered, never asserted |
| `cleanup-non-interactive-confirm-flag` | `< → >=` `usage.ts:16` | verifier defect, see `mutation-verifier-flips-operators-inside-string-literals` |

Each stall cost a full re-run cycle (~10–15 min plus tokens), and each was recoverable only by an
operator tightening the spec's acceptance criteria by hand.

**Coverage would have caught only some of these, and that distinction is the whole design.** The
`cleanup.ts:161` fallback was never executed — line coverage flags it instantly, for the price of one
test run. But `run.ts:28` and `write-loop.ts:215` were *executed and unasserted*: line coverage
reports them green and says nothing useful. Coverage is a cheap pre-filter that catches the
never-executed class early; the mutation gate remains the only thing that catches the
executed-but-unasserted class.

## Decisions

- Report **uncovered changed lines**, scoped to the run-base production diff — the same scope
  `diff-derived-mutation-verifier.ts` already computes. Rules out whole-repo coverage reports, which
  bury the signal the agent needs in thousands of irrelevant lines.
- Surface it to the agent **during the write step**, before the completion boundary. Rules out
  adding it as another post-completion gate, which reproduces the expensive-and-late problem it
  exists to fix.
- **Advisory, not gating.** Rules out failing a run on uncovered lines; the mutation verifier is
  already the authority on whether coverage is adequate.
- **No coverage percentage and no threshold, ever.** A percentage target rewards tests that execute
  code without asserting on it — precisely the `run.ts:28` and `write-loop.ts:215` failures above. A
  threshold would push agents toward the exact pathology the mutation gate exists to catch. Rules
  out `coverageThreshold` in `bunfig.toml` and any "coverage must be ≥ N%" criterion.
- State the limitation in the agent-facing output: executed ≠ asserted. Rules out the agent reading
  a clean coverage report as evidence its changes are pinned.

## Acceptance criteria

- [ ] The write step reports uncovered changed production lines for the run-base diff, naming file
      and line.
- [ ] A changed line that no test executes appears in that report; a changed line executed by a test
      does not.
- [ ] The report is advisory: a run with uncovered changed lines still reaches the completion
      boundary and is judged by the existing gates.
- [ ] No coverage percentage, ratio, or threshold is computed, reported, or enforced anywhere.
- [ ] The agent-facing text states that executed lines may still be unasserted and that the mutation
      verifier, not coverage, decides adequacy.
- [ ] Regression coverage pins the `cleanup.ts:161`-shaped case: an unreachable branch in the diff is
      reported as uncovered.
- [ ] Coverage collection does not measurably extend the write step beyond one scoped test run.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — uncovered-changed-line reporting in the write step.
- `v2/docs/test-writing.md` — coverage is a pre-filter; assertion adequacy is the mutation gate's job.
- `v2/docs/operator-runbook.md` § Gate trust — what the coverage report does and does not certify.

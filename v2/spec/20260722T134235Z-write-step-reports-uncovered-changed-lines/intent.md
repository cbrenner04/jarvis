---
name: write-step-reports-uncovered-changed-lines
---

# Write step reports uncovered changed lines

The write step never tells the agent which of its changed lines no test executes. Coverage scripts
exist in `package.json` but nothing runs them — not CI, not the ready gate, not the write step. The
never-executed class of gap is therefore only caught by the mutation verifier, after write, review,
commit, push, PR, and a green ready gate (four `surviving_mutation_failed` stalls observed
2026-07-21; `cleanup.ts:161` was an unreachable fallback line coverage would have flagged instantly).

Report uncovered changed production lines to the agent inside the write step, advisory only.

## Decisions

- Scope the report to the run-base production diff, reusing the scope `diff-derived-mutation-verifier.ts` already computes — rules out a whole-repo coverage report that buries the signal.
- Surface it during the write step, before the completion boundary — rules out another post-completion gate, which reproduces the expensive-and-late failure this exists to fix.
- Advisory, never gating: uncovered lines do not fail or block a run — the mutation verifier stays the authority on adequacy.
- Compute and report no percentage, ratio, or threshold anywhere — a percentage target rewards executing code without asserting on it, the exact `run.ts:28` / `write-loop.ts:215` pathology; rules out `coverageThreshold` in `bunfig.toml`.
- The agent-facing text states executed ≠ asserted, and that the mutation verifier decides adequacy — rules out the agent reading a clean report as evidence its changes are pinned.
- Collect coverage from one scoped test run, not a repo-wide one.

## Acceptance criteria

- [ ] The write step reports uncovered changed production lines for the run-base diff, naming file and line.
- [ ] A changed line no test executes appears in the report; a changed line a test executes does not.
- [ ] A run with uncovered changed lines still reaches the completion boundary and is judged by the existing gates.
- [ ] No coverage percentage, ratio, or threshold is computed, reported, or enforced.
- [ ] The agent-facing text states executed lines may still be unasserted and that the mutation verifier, not coverage, decides adequacy.
- [ ] Regression coverage pins the `cleanup.ts:161`-shaped case: an unreachable branch in the diff is reported as uncovered.
- [ ] Coverage collection adds no test run beyond the one scoped run.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — uncovered-changed-line reporting in the write step.
- `v2/docs/test-writing.md` — coverage is a pre-filter; assertion adequacy is the mutation gate's job.
- `v2/docs/operator-runbook.md` § Gate trust — what the coverage report does and does not certify.

## Prerequisites

- The run-base production diff scope is computed and reused by diff-derived mutation verification.
- Changed paths map to scoped test scripts (`scripts/ci-test-scope.ts`).

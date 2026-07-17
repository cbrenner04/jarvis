# Implement completion should require adversarial mutation verification, not a green gate

## Problem

A green ready gate is not evidence the code works, and the operator has to run **manual mutation
review** on every implement PR to catch it. That manual step is the harness gap: the harness ships
`completed` on a green suite that proves nothing, and a human (or a hand-spawned subagent) is the only
thing standing between a vacuous no-op and `main`.

The evidence is overwhelming and repeated. The `jarvis cleanup` spec was implemented and **rejected
six times** (#1672, #1675, #1682, #1686, #1694, and attempt 6 pre-hand-finalize), **every one** with
100% of acceptance criteria ticked and a fully green gate (typecheck, biome, tests, CI). Each was a
permanent no-op or a data-loss hazard that no gate caught:

- #1672: `gh pr view --head` (invalid flag) → always ineligible → discovery returns `[]`. Hidden by a
  stub matching the command *name* and answering `MERGED` regardless of argv.
- #1686: `gh pr list --head` with no `--state` → merged PRs return `[]` → no-op. Mocks hard-coded
  `MERGED`, so even an argv assertion passed.
- #1694: worktree check ran with `stdio:"ignore"` (resolves to `""`) → `"" === "true"` always false →
  discovery a no-op; the "end-to-end" test called the runner in its own body, never invoking `main`.
- Others: `rmSync` orphaning branches, daemon-unreachable read as permission, guards wired only into
  tests and never into the production CLI.

The single technique that caught all of them: **mutation testing** — deliberately break the
production code one change at a time and confirm a test goes red. Where the suite stayed green under a
mutation, that guard was not load-bearing and the "passing" test was theater. This is what the
operator now runs by hand (a subagent that fetches the PR head, mutates each guard, records the
pass/fail delta, and a runtime smoke — e.g. `cleanup --dry-run` against real state). It should be the
harness's job.

## Decisions

- The implement workflow gains an **adversarial verification step** before a run may report
  `completed`: for the diff's changed production surface, apply a bounded set of guard mutations and
  require that at least one test fails per mutation; a mutation that leaves the suite green fails the
  step with the specific unguarded site named. Rules out treating a green gate as sufficient.
- Verification includes a **runtime smoke** where the change has a runnable surface (drive the real
  entrypoint and observe behavior, not just tests); rules out the no-op class the unit tests missed.
- The mutation set is derived from the diff (reverting changed subprocess argv, flipping new
  fail-closed guards to fail-open, replacing a destructive call's safe variant), not a fixed list;
  rules out a generic mutation pass that misses the domain guards.
- The step is part of the gate that flips a run to `completed`, not an optional review preset; rules
  out shipping vacuous code because review was not requested.
- Cost-bounded: the step runs only over the diff's production files, with a capped mutation count and
  a timeout; rules out a full-repo mutation sweep that dominates wall clock.

## Notes

Generalizes the specific instances already seeded — `agent-authored-subprocess-mocks-assert-nothing-about-argv`
(subprocess-name-matching stubs) and `acceptance-criteria-must-be-satisfiable-by-the-agent`
(self-graded AC) — into the root fix: **the harness verifies, rather than trusting a green suite.**
The v2 review presets debate/read the diff; they do not mutation-test it, which is why they miss this
class. Consider whether this is a new gate stage or a hardening of the existing review step.

Until this ships, the operator runbook's "review every implement diff, distrust a green suite on code
with no test seam" caveat stands, and the manual mutation-review subagent is the stopgap. Cleanup:
delete that caveat when this lands.

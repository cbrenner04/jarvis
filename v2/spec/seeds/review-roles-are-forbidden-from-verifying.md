# Review roles are forbidden from running anything

## Problem

Every implement review prompt carries this rule:

```md
- **Do not run tests.** Report issues you find based on code review, not test results.
```

(`prompts/patch/review-critic.md`, `review-adversary.md`, `review-advocate.md`,
`review-adjudicator.md`, `review.md`.)

So a role asked to find "potential bugs or subtle logic errors" may not perform any check that
would distinguish a real bug from a plausible one. Two defects that reached green PRs on
2026-07-21 were each found in under a minute by *executing* something, and neither is reachable by
reading alone:

- **#1880** — the daemon's executable-tree digest was `sha256("")` because git resolves pathspecs
  against cwd and the caller passed a subdirectory. Found by computing the digest from two
  directories and comparing: `226 entries` vs `0 entries`. Static reading of the same lines looks
  correct.
- **#1872** / **#1880** — guards with no constraining test. Found by reverting the guard and
  running the scoped suite: `0 failures` across 144 tests. Nothing in the source says a guard is
  unconstrained; only the experiment says it.

The prohibition also sits oddly beside the rule directly above it, which already handles the risk
it appears aimed at: "Spec-tree and code edits are reverted by the harness." Safety comes from
reverting, not from prohibition — and reading, running, and reverting is what a human reviewer
does.

Cost is the real constraint, and it is a live one: a full `bun run test:v2` is minutes of wall
clock and a large amount of output. The answer is a bounded, scoped verification budget, not a
blanket ban.

## Decisions

- Permit read-only verification during implement review: run scoped tests, execute code, inspect
  runtime behavior. Rules out the current blanket prohibition.
- Bound it explicitly — a wall-clock budget and a scope narrower than the full suite. Pin the
  budget and the allowed scope in the plan; "run the whole suite" is not an acceptable default,
  as it is slow, token-heavy, and mostly irrelevant to the diff under review.
- The review boundary stays read-only in effect: any edit a role makes to run an experiment is
  reverted by the harness before the verdict lands, as it already is today.
- The verdict should be able to cite what was executed and observed, so an actuator and an operator
  can tell a measured finding from a speculative one.
- Rules out granting review roles commit, push, or PR access.
- Depends on `review-roles-never-receive-the-diff`: a role that cannot see the change has nothing
  to target an experiment at.

## Acceptance criteria

- [ ] Implement review prompts no longer forbid running tests, and state the permitted scope and
      budget instead.
- [ ] A review role can run a scoped test command and read its result within the stated budget.
- [ ] Exceeding the budget terminates the role's verification without failing the review outright.
- [ ] Any tree modification made during review is reverted before the verdict is persisted, and a
      regression proves the worktree is clean afterward.
- [ ] Review roles still cannot commit, push, or open PRs.
- [ ] A verdict can carry an executed-and-observed citation distinguishable from a static claim.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — review verification scope and budget.
- `v2/docs/operator-runbook.md` § Gate trust — what a review verdict now certifies.
- `v2/docs/v1-behaviors.md` — record the changed review contract.

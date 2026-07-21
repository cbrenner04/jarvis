# Give review roles one scoped verification command

## Problem

Review roles can only reason statically. The two worst defects of 2026-07-21 were each settled in
under a minute by *running* something, and neither was reachable by reading:

- A guard with no constraining test. Reverting it and running the scoped suite gave `0 failures`
  across 144 tests. Nothing in the source says a guard is unconstrained.
- A digest computed from the wrong directory. Comparing the value from two cwds gave `226 entries`
  vs `0`. The lines read correctly.

Both were found by an operator-run subagent that had a shell. The harness's own review roles have
neither the diff (`review-roles-never-receive-the-diff`) nor permission to execute
(`review-roles-are-forbidden-from-verifying`). Same models, different tools.

The naive fix — let the reviewer run whatever it likes — is wrong: a full `bun run test:v2` is
minutes of wall clock and a large volume of output that is mostly irrelevant to the diff, and it
puts an unbounded cost inside every review pass.

## Decisions

- Expose verification as a **harness-mediated command** the prompt teaches, not as a vendor tool
  call. Jarvis already owns the invocation boundary and spawns the agent in a worktree; a command
  works identically across `claude`, `codex`, and `cursor` and survives adding a fourth. Rules out
  per-vendor tool protocols, which would mean one implementation and one failure mode per vendor.
- Scope narrowness is a property of the command, not of agent restraint: the command mutates one
  named guard and runs only the tests that reach it. There is no argument that widens it to the
  full suite.
- **Reviewer only** to start. The writer does not get it: an author optimizing against the verifier
  may write a test that kills the mutation rather than a test that pins the behavior. Revisit after
  measuring reviewer results.
- Return a decisive one-line result (`killed by <test>` / `survived`), not a test log. If the agent
  must interpret output, the token cost the scoping saved comes straight back.
- Findings flow to the actuator **with the verdict**, on the existing verdict channel; a survived
  mutation becomes a required outcome like any other. Rules out a separate result path.
- Enforce a per-review budget on invocations and wall clock; exceeding it ends verification without
  failing the review.
- Depends on `review-roles-never-receive-the-diff`: a role that cannot see the change has nothing
  to point the command at.

## Acceptance criteria

- [ ] A review role can invoke the command against one guard identified by file and line, and
      receives a single-line verdict naming the killing test or reporting survival.
- [ ] The command runs only tests reaching that guard; a full-suite run is not reachable through it.
- [ ] Results are surfaced to the actuator through the existing verdict, and a survived mutation
      reads as a required outcome.
- [ ] Invocation count and wall clock are bounded per review pass; exceeding either ends
      verification cleanly without failing the review.
- [ ] Any tree mutation the command makes is reverted before it returns, and a regression proves
      the worktree is clean afterward.
- [ ] The command is invoked identically regardless of which agent is bound to the review role.
- [ ] Writer roles have no access to it.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — the reviewer verification command, its scope and budget.
- `v2/docs/operator-runbook.md` § Gate trust — what a verdict certifies once reviewers can measure.

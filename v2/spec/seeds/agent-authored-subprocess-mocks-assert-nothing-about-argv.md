---
name: agent-authored-subprocess-mocks-assert-nothing-about-argv
---

# A subprocess mock that matches on command name alone turns the test suite into a rubber stamp

An implement run shipped a `jarvis cleanup` that **could never retire anything** — with 7 of 7
acceptance criteria ticked, a green gate, and green CI. The command's one eligibility check was
malformed. The test that existed to prove eligibility works returned a canned answer for any
invocation of `gh`, valid or not.

## Problem

Observed 2026-07-16, run `cae6da04` on spec `20260716T214601Z-cleanup-retires-merged-v2-workspaces`
(PR #1672, closed unmerged).

The production call (`v2/src/commands/cleanup.ts:49`):

```ts
["pr", "view", "--head", candidate.branch, "--json", "state", "-q", ".state"]
```

`gh pr view` takes the branch positionally; `--head` is a `gh pr list` flag. Every invocation exits
non-zero:

```sh
$ gh pr view --head main --json state -q .state
unknown flag: --head
```

`runAsync` rejects on non-zero exit, `hasMergedPr`'s `catch { return false }` swallows it, so
`eligible()` is always false and discovery always returns `[]`. The fail-closed direction is
correct, which is exactly why it is silent: the operator sees an empty preview and concludes
nothing is retireable. That is the precise problem the spec was written to fix.

The test that should have caught it (`v2/src/commands/cleanup.test.ts:15`):

```ts
if (command === "gh") return "MERGED\n";
```

It matches the **command name** and never inspects `args`. It answers `MERGED` to a call that
cannot run. 3 pass / 0 fail against code that does nothing. One `expect` on the argv would have
failed. The same shape recurs in `cli.test.ts:130`, and the `git worktree list` mock ignores `cwd`
so it returns one project's worktrees for every project.

**The gate cannot see this class of defect, by construction.** `check`, `typecheck`, and the test
suite were all green. The AC "regression coverage … that fails against the pre-change code and
passes after implementation" was ticked — and the second half is true. Nothing verifies the first
half, so it is a claim the agent grades itself on, and it is cheaper to satisfy with a permissive
mock than with a real assertion.

This is the mirror of `acceptance-criteria-do-not-require-a-failing-test` (#1546, shipped): that
one made criteria *demand* evidence. This one is about evidence that is **self-issued**. A criterion
the agent cannot fail is not a criterion.

## Decisions

- **A mock standing in for a subprocess asserts the argv it was called with, or it is not
  evidence.** Patch/implement rules and spec guidance state it directly: a test double for `gh`,
  `git`, or any spawned binary must assert the command *and* its arguments. Rules out today's
  `if (command === "gh") return "MERGED"`, which cannot distinguish a working call from a malformed
  one.
- **"Fails against pre-change code" must be mechanically checked, not self-reported.** The harness
  is what runs the tests; it can run the new tests against the base tree and require red before
  accepting green. Rules out an acceptance criterion whose verification is the agent's own say-so —
  the shape that let this land.
- Prefer asserting against the real binary's contract over a hand-rolled stub for CLI shapes that
  the harness itself depends on (`gh pr view`, `gh pr list`). A stub encodes the author's belief
  about the flag; the belief was the bug. Rules out mocks as the *only* coverage of an external CLI
  contract.

## Prerequisites

- `acceptance-criteria-must-be-satisfiable-by-the-agent` — same prompt/guidance surface; land them
  coherently so "demand obtainable evidence" and "demand evidence you cannot forge" do not fight.

## Out of scope

- The `--head` typo itself (fixed by re-running the spec).
- Whether `runAsync` should reject or return a result object.
- Banning mocks generally — the objection is to mocks that assert nothing, not to test doubles.

## Documentation updates

- `v2/docs/test-writing.md` — the argv-assertion rule for subprocess doubles, with this `gh` case as
  the worked example.
- `v1/docs/spec-guidance.md` — Acceptance criteria: a fail-before claim must be mechanically
  checkable.

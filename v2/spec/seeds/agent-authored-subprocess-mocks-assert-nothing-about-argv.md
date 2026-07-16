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
- **Code that reads a filesystem or process root takes it as an injectable dependency.** A function
  resolving `~/.jarvis` (or `$HOME`, or a daemon socket) internally has no test seam, so the only
  green path is a mock that bypasses it — which is what both agents built. Rules out treating this
  as an agent-quality problem: two models failed identically because the shape admitted no honest
  test. Where a spec's criteria require testing such a function, the spec owes the seam.

## Second instance: a stronger agent produced a *worse* rubber stamp (2026-07-16)

The spec was re-run from scratch on claude after codex's attempt was rejected. Claude fixed the
`--head` typo — and its test suite was **100% vacuous**, strictly worse than the mock above.

Every test passes a fabricated registry (`{ testproj: { root: "/path/to/repo" } }`) while
`discoverWorktreeCandidates` reads the **real** `~/.jarvis/worktrees/<projectKey>`. That path does
not exist, so discovery returns zero candidates and every test exercises the early-return. The
`isMergedPr` and `listRunsFromDaemon` mocks are never invoked. The two guard tests assert
`toContain("no merged worktrees to remove")` — the *zero-candidates* string — so they pass with the
guards deleted.

Demonstrated, not inferred: restoring the original `--head` bug **and** stubbing
`checkWorktreeEligibility` to `return { candidate, eligible: true }` (every guard removed) still
yields **7 pass / 0 fail**. The suite proves nothing about the code it covers.

It also hid two defects the tests would have caught on contact:

- `removeWorktree` is `rmSync` with no `git worktree remove`/`prune`, so the registration survives
  and the subsequent `git branch -d`/`-D` **always** fails (`cannot delete branch 'x' used by
  worktree at …`). Every eligible worktree ends half-mutated: directory gone, branch orphaned,
  command exits 1, re-run not idempotent.
- The CLI's `listRunsFromDaemon` swallows errors (`catch { return [] }`), so a **daemon-down**
  ownership check reads as blanket permission — fail-open in exactly the case the spec says must
  fail closed.

**Two independent agents, two rejections, same root cause — so this is a property of the code
shape, not the model.** `discoverWorktreeCandidates` resolves `~/.jarvis` internally and takes no
injectable root. There is no seam to test against, so the only way to make the suite green is to
mock around the thing under test. Both agents did, in different ways, and both ticked the
fail-before criterion.

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

---
name: implement-preflight-stale-workspace-gates
---

# The implement preflight must refuse a stale worktree and must not retire landed ticks

`resetStaleWorkspace` (`v2/src/commands/cleanup.ts`, reached from `maybeResetStaleWorkspace`) gates on
live holds, open PRs, daemon claims, and dirtiness — never on whether the managed worktree's HEAD
still descends from the resolved `--base`. On run `eabc39a7` (2026-08-03) it neither retired nor
refused a worktree three commits behind `--base` with four modified tracked paths left by an earlier
`iteration_timeout` run; the write step then read that worktree's already-ticked spec copy and settled
`completed` having committed nothing. The reverse hazard is the same function's success path: on a
timeout re-run it retires a worktree, branch, and remote branch that may carry finished subspec work.

**Root cause of the reuse is not established.** Re-running the identical command later refused at the
live-run gate, which precedes the dirty gate, so the dirty gate was never exercised in reproduction.
The reproduction lands before the fix.

## Decisions

- A reproduction driving the preflight against a worktree behind `--base` with uncommitted tracked
  paths lands before any fix — rules out cutting a fix against a guessed cause.
- The preflight refuses when the managed worktree HEAD is not a descendant of the resolved `--base`,
  independently of dirty state, naming base and worktree HEAD — rules out silently reusing a stale
  branch tip whose spec copy disagrees with the base.
- Gate precedence is **preserve before reuse**: the preserve gate (criteria ticked in the worktree but
  unticked on `--base`) is checked before the stale/dirty reuse refusal — rules out gate order being
  decided implicitly by whichever gate lands second.
- A worktree that is both dirty and carrying ticks absent from `--base` refuses with both conditions
  named — rules out a first-match refusal that hides the destructive condition.
- The preserve gate's override is a distinct flag from `--reset-despite-dirty` — rules out an operator
  waiving dirtiness and silently discarding landed subspec work.
- The tick comparison uses the same fully-ticked criteria predicate as routing — rules out preflight
  and router disagreeing about what "done" means.

## Acceptance criteria

- [ ] A regression drives the preflight against a managed worktree whose HEAD is behind the resolved
      base **and** has uncommitted tracked paths, and asserts a refusal naming those paths; it fails
      against the current preflight.
- [ ] A regression asserts a refusal when the managed worktree HEAD is not a descendant of the resolved
      `--base` with a clean worktree, naming base and worktree HEAD.
- [ ] `resetStaleWorkspace` refuses to retire a workspace whose worktree spec tree has criteria ticked
      that are unticked on `--base`, names those subspec paths on stderr, and changes nothing; the
      documented override flag proceeds. A regression covers both.
- [ ] A regression pins that a dirty worktree carrying ticks absent from `--base` refuses with both
      conditions named, proving the preserve gate runs before the reuse gate.
- [ ] Mutation checkpoint: inverting the descendant check turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — document the descendant refusal, the retirement refusal,
  and its override flag.
- `v2/docs/v1-behaviors.md` — record the descendant-check preflight and the preserve-before-reuse gate
  order.

## Prerequisites

- A subspec's completeness is decided by a shared fully-ticked non-human-only criteria predicate.
- The router selects the first linked subspec with an unticked non-human-only acceptance criterion, independent of its index checkbox.
- A write step resolving `no-work` over uncommitted tracked paths settles a non-`completed` status naming those paths.
- `resetStaleWorkspace` gates stale-workspace retirement on live holds, open PRs, daemon claims, and dirtiness before retiring worktree, local branch, and remote branch.
- `--reset-despite-dirty` waives the dirty-worktree gate on implement and plan workflow starts.

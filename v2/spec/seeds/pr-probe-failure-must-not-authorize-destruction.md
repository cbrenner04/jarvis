---
name: pr-probe-failure-must-not-authorize-destruction
---

# A failed `gh` probe is read as "no open PRs", and that answer authorizes destruction

## Problem

`gateOnOpenPrs` (`v2/src/commands/cleanup.ts:2000-2014`) collapses "the PR probe failed" into "there are no PRs":

```ts
try {
  openPrs = await listOpenPrsForBranch(branch, ".", runner);
} catch {
  openPrs = [];
}
```

The doc comment above it states the intent plainly — failures are treated "as `no open PRs`". Every downstream guard then reads an *inconclusive* answer as a *permissive* one.

This directly inverts the brief's own rule: **a guard deciding whether to destroy or land something treats every inconclusive answer as "do not act."** It is the same shape as the daemon socket outage, where a sandboxed caller's `ENOENT` for a live socket was read as authoritative absence and unlinked a healthy daemon's entry.

**The path is reachable, not theoretical.** `gh` false-negatives under the sandbox that every agent session runs in — the operator runbook already documents that `gh` and `git push` must be run with the sandbox disabled for this reason. A sandboxed caller therefore gets the permissive answer by default.

**It is becoming more load-bearing.** `--abandon`'s PR-ownership gates already depend on it: an unreachable `gh` turns "single matching PR is ready (non-draft)" — the guard whose entire job is protecting operator-reviewed branches from force-retirement — into a silent pass. The disposable-lane work now landing routes `classifyNeverLandedLane` through the same probe, so a lane with a live PR classifies as never-landed whenever `gh` is broken, which in turn authorizes bypassing the descendant and landed-criteria gates and destroying the worktree.

Cleanup's merged-worktree slice already gets this right — a `gh` failure there marks the worktree **ineligible** and skips it (fail-closed). The defect is that the abandon/classification path does the opposite with the same information.

## Decisions

- `listOpenPrsForBranch` failure is a distinct third outcome — `unknown` — never folded into the empty list; rules out a probe error and a genuinely PR-free branch producing the same value.
- Every guard whose decision can destroy or bypass (abandon's PR-ownership gates, never-landed classification, disposable-lane admission) refuses on `unknown` and names the probe failure; rules out an inconclusive probe widening permission.
- The refusal names `gh` reachability as the cause and the recovery, since the dominant trigger is a sandboxed caller rather than a broken repo; rules out an operator reading it as "the branch has no PR".
- Non-destructive readers may still degrade to the permissive answer where that is safe, but must do so explicitly at the call site rather than inheriting it from the probe; rules out one swallow serving both destructive and informational callers.
- Align with cleanup's merged-worktree slice, which already fails closed on `gh` failure; rules out two opposite policies for the same signal in one file.

## Acceptance criteria

- [ ] A `cleanup.test.ts` test proves a `listOpenPrsForBranch` failure yields an `unknown` outcome distinct from an empty result; it fails against the current `catch { openPrs = [] }`.
- [ ] A test proves `--abandon` refuses, changes nothing, and names probe failure when the PR probe throws — including the case where the branch really does have a ready non-draft PR that the probe could not see; it fails against the current silent pass.
- [ ] A test proves never-landed classification refuses (does not classify never-landed) when the PR probe fails, so descendant and landed-criteria bypass is not authorized; it fails against a classifier that treats probe failure as "no PR".
- [ ] A test proves a branch that genuinely has no open PR still classifies and abandons exactly as today.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `--abandon` and cleanup refusals on an unreachable `gh`; note the sandboxed-caller trigger.
- `v2/docs/v1-behaviors.md` — record fail-closed PR-probe semantics for destructive guards.

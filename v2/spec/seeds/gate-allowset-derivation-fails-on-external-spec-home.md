---
name: gate-allowset-derivation-fails-on-external-spec-home
---

# Ready-gate repair fence cannot derive paths for an external spec home, and says nothing about why

## Problem

On a `plan.commit: false` project the spec tree lives outside the repo (`~/.jarvis/specs/<project>/plans/<name>/`). `deriveGateAllowedPaths` enumerates the spec tree and rejects every path in it, returns `undefined`, and the run settles `completion_commit_failed: "Ready-gate repair fence could not derive allowed paths"` — **after** the branch is pushed and the draft PR is open, with all subspec work complete and the gate green. The lane cannot finish itself: the PR stays draft and the plan tree is never ticked (#3423).

The near-miss is the whole bug. `resolveSpecScopeRoot` (`v2/src/execution/ready-finalize.ts:634`) *succeeds* on an external absolute `specPath`:

```ts
const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  if (statSync(resolvedSpecPath).isDirectory()) { return resolvedSpecPath; }
if (basename(resolvedSpecPath).endsWith(".md")) { return dirname(resolvedSpecPath); }
```

so the graceful `scopeRoot === null` fallback (`:651-658`, which routes through `normalizePublicationSpecPath`) is **unreachable** — it only fires when the directory does not exist. Enumeration then does:

```ts
const rel = relative(worktreePath, file).replace(/\\/g, "/");
const validated = validateRepoRelativePath(rel);
if (validated === undefined) { return null; }
```

`rel` begins with `../`, and `validateRepoRelativePath` rejects `..` segments (`:237-239`) → `null` → `deriveGateAllowedPaths` returns `undefined` at `:720`.

**Same root as #3417** (external plan tree tripping a path guard in the same phase of the same workflow), as the reporter suspected.

Second, independent defect: **the failure is silent.** `deriveGateAllowedPaths` has eight distinct `undefined` returns (`:697`, `:701`, `:714`, `:718`, `:720`, `:725`, `:729`, `:735-737`) and logs on none of them. The call site (`v2/src/execution/write-loop.ts:2877-2884`) synthesizes a bare `Error` with no branch identity, so the detail string exists only on the `run list` row; the run log carries just `iteration_started` / `loop_finished`. Nothing tells an operator which input failed or what would make derivation succeed, and `nextAction: resume` is offered with no basis for expecting a different outcome.

## Evidence

Issue #3423, project `homestead-service`, jarvis `9096b1a87`, entry run `29069573`. Five-subspec external plan tree; every subspec row and the review row `completed`; seven commits on the branch, branch pushed, draft PR #12 open, `npm run ready` green (180 unit / 165 e2e). Only the completion-commit row failed. Hand-finished.

The reporter counts this as the fourth distinct way an implement lane failed to finish itself in one session with the code work intact — alongside #3417, #3395, and a silent no-push.

## Decisions

- Spec-tree enumeration resolves paths relative to the **spec scope root**, not the code worktree, so an external spec home yields valid entries instead of `..`-prefixed rejects; rules out a guard intended for repo-relative safety rejecting a legitimately out-of-repo spec home.
- An external spec home is classified before validation, not discovered by a rejected path: `resolveSpecScopeRoot` reports whether the root is inside the worktree, and out-of-worktree roots take the `normalizePublicationSpecPath` path the `scopeRoot === null` fallback already implements; rules out the fallback staying unreachable whenever the external directory happens to exist.
- Every `undefined` return in `deriveGateAllowedPaths` carries a distinct named reason, and the caller records it as a durable log record before settling; rules out eight failure modes collapsing to one opaque string diagnosable only from `run list`.
- A fence that cannot derive paths for a lane whose work is complete, pushed, and published does not settle the lane `failed`: it settles honestly for a lane with nothing left to repair (the fence's purpose is bounding *repair* edits, and there is no repair in flight); rules out `completion_commit_failed` on a lane the harness has already published.
- `nextAction` reflects what a resume would actually retry; a derivation failure resume cannot fix projects `stop` with the reason, not `resume`; rules out offering a recovery verb with no basis (mechanism shared with [[terminal-state-honesty-invariant]]).

## Acceptance criteria

- [ ] A `ready-finalize` test proves `deriveGateAllowedPaths` returns a non-empty allowset for a worktree whose `specPath` is an absolute directory outside that worktree (the `plan.commit: false` shape); it fails against the current `..`-rejection returning `undefined`.
- [ ] A test proves the out-of-worktree spec-home path is taken when the external directory **exists**, not only when it is absent; it fails while `resolveSpecScopeRoot` returning a real directory bypasses the fallback.
- [ ] A test asserts each distinct derivation failure returns its own named reason, and a write-loop test asserts that reason is written to the run log before settlement; it fails against the current unlogged bare `Error`.
- [ ] A write-loop test proves a lane whose branch is pushed with an open PR and all criteria ticked does not settle `completion_commit_failed` on a fence-derivation failure, and does not advertise `nextAction: "resume"` for a failure resume cannot clear.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — allowset derivation over an external spec home; named derivation-failure reasons.
- `v2/docs/operator-runbook.md` — what a fence-derivation failure means and why resume is not the recovery.
- `v2/docs/v1-behaviors.md` — record external-spec-home allowset derivation and honest settlement.

---
name: subspec-inventory-relativizes-against-the-wrong-root
---

# Subspec completion inventory relativizes worktree paths against the project root, so it is always empty — and that silently forfeits resume

## Problem

`buildSubspecCompletionInventory` (`v2/src/execution/write-loop.ts:231`) resolves each linked subspec **inside the managed worktree**, then converts it to a repo-relative path against **`projectRoot`**:

```ts
const resolvedPath = isAbsolute(link.path) ? link.path : resolve(dirname(indexPath), link.path);
const rel = repoRelativeSubspecPath(projectRoot, resolvedPath);
if (rel === undefined) continue;
```

`repoRelativeSubspecPath` (`:217`) returns `undefined` when the relative path escapes:

```ts
const rel = relative(resolve(projectRoot), resolve(absolutePath));
if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
```

For every git-enabled workflow run, `indexPath` is under `~/.jarvis/worktrees/<project>/<branch>/` while `projectRoot` is the operator's checkout. The relative path is therefore `../../..`-prefixed, `rel` is `undefined`, and **every subspec hits `continue`** — so both `completedSubspecPaths` and `remainingSubspecPaths` come back empty, on every run, regardless of actual progress.

The consequence is not cosmetic. `hasCompletedSubspec` (`:170`) is `completedSubspecPaths.length > 0`, and it gates `resumable` on the `iteration_timeout` settlement. An empty inventory therefore makes a timeout **non-resumable by construction** — the documented `iteration_timeout with completed subspecs` recovery (`jarvis run resume` on the retained workspace) can never trigger for a managed worktree, which is every implement lane.

So the harness discards a valid resume path and reports no progress on work it has already committed.

## Reproduction (2026-09-06, exact)

Two implement lanes timed out under load with real work committed:

| Run | Committed | Subspec 00 | Row reported |
| --- | --- | --- | --- |
| `ec7cc3aa` | 1 commit, +603 lines | **12/12 ACs ticked** | `completedSubspecPaths: []`, `remainingSubspecPaths: []`, `resumable: false` |
| `1e0d0544` | 1 commit, +89 lines | 6/7 ACs | same empty shape |

Driving the function directly against `ec7cc3aa`'s real worktree isolates the argument at fault:

```text
projectRoot = <the managed worktree>      → completed: [00…], remaining: [01…, 02…, 03…]
projectRoot = <the operator's checkout>   → completed: [],     remaining: []
```

Same worktree, same spec, same files. Only the root differs, and the second shape is the one a real run passes.

`ec7cc3aa` is the sharp case: a fully-ticked, committed subspec reported as no completed subspecs and no resume path.

## Decisions

- The inventory relativizes against the root the subspecs actually live under (the worktree when one is materialized), not `projectRoot`; rules out a repo-relative conversion that can only ever fail for managed worktrees.
- A subspec whose path cannot be relativized is a **named failure**, never a silent `continue`; an inventory that discards every entry must not be indistinguishable from a spec with no linked subspecs; rules out the fail-soft `catch`/`continue` masking a total miss (this is the same "inconclusive is not permissive" rule as [[pr-probe-failure-must-not-authorize-destruction]]).
- Reported paths stay stable and repo-relative for operators regardless of which root they were derived from; rules out leaking absolute worktree paths into `loop_finished` output.
- `resumable` on `iteration_timeout` derives from an inventory that was actually computed; an inventory that failed to resolve does not read as "nothing completed"; rules out forfeiting resume because a path computation failed.

## Acceptance criteria

- [ ] A `write-loop` test proves `buildSubspecCompletionInventory` classifies subspecs correctly when the index lives in a managed worktree and `projectRoot` is a different directory; it fails against the current `repoRelativeSubspecPath(projectRoot, …)` returning `undefined` for every entry.
- [ ] A test proves the returned paths are repo-relative (no absolute worktree prefix) in that same case.
- [ ] A test proves an unrelativizable subspec path surfaces a named failure rather than being silently skipped; it fails against the current `continue`.
- [ ] A test proves an `iteration_timeout` after one linked subspec's non-human-only criteria are fully ticked settles `resumable: true` and lists that subspec in `completedSubspecPaths`; it fails against the current empty-inventory settlement.
- [ ] A test proves a spec with genuinely zero linked subspecs still yields empty lists without a failure.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `iteration_timeout with completed subspecs` now actually reachable; retire the implication that an empty `completedSubspecPaths` means no progress.
- `v2/docs/write-behavior.md` — inventory root resolution and the named-failure contract.
- `v2/docs/v1-behaviors.md` — record inventory relativization against the worktree root.

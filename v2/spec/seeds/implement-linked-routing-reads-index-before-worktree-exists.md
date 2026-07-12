# implement's linked-index routing reads the index inside a worktree that doesn't exist yet

`jarvis run workflow implement` is still dead on first launch. The P0 fix
(#1417, `implement-preflight-validates-project-root-spec`) corrected the **CLI
preflight** but not the **runner**, so the same chicken-and-egg ENOENT survives one
layer down.

## Problem

Observed 2026-07-12, on `main` at `4525d3a9` (i.e. *after* #1417 merged and the
spec was archived to `completed/`):

```sh
jarvis run workflow implement --base main \
  --spec v2/spec/2026-07-12T21-57-58Z-daemon-process-log-read/index.md
```

```
invalid_params: ENOENT: no such file or directory, open
  '/Users/…/.jarvis/worktrees/jarvis/2026-07-12T21-57-58Z-daemon-process-log-read/v2/spec/2026-07-12T21-57-58Z-daemon-process-log-read/index.md'
```

Root cause is `runLinkedImplementStep` in `v2/src/execution/workflow-runner.ts`:

```ts
const worktreePath = getExternalWorktreePath(step.worktree);
const indexPath = resolveInWorktree(worktreePath, step.specPath);   // :485

for (;;) {
  const beforeIndexContent = readFileSync(indexPath, "utf8");       // :490  ← ENOENT
  const routing = resolveActiveLinkedSubspec(indexPath, worktreePath);
```

The index is read from the **worktree** before the write loop — which is what
creates the worktree — has ever run. On a first launch the worktree does not
exist, so the very first `readFileSync` throws. The rejection surfaces as a
generic `invalid_params` because `executeWorkflow`'s rejection is caught by the
catch-all at `v2/src/daemon/daemon.ts:471-477`.

#1417 validated `--spec`/`--artifact` against the registered project root *in
preflight*, which is correct and should stay. It simply never touched the routing
read, so index-routed implement (the only shape the `implement` preset builds)
still cannot start.

## Scope

- Ensure the worktree exists before any linked-index routing read, or seed the
  first routing read from the project root and only switch to worktree-relative
  reads once the worktree exists.
- The write loop must remain the thing that consumes worktree-relative paths;
  don't regress #1417's preflight contract.
- Regression coverage must exercise a **first launch** — spec at project root, no
  worktree on disk — through `runLinkedImplementStep` to the write step. The
  existing tests pass because they pre-create the worktree, which is precisely the
  state a first launch does not have.

## Decisions

- Fix the runner, not the preflight. Project-root-relative is the correct operator
  contract (`v2/docs/first-workflow-walkthrough.md`) and #1417 already encodes it.
- A test that pre-creates the worktree is not regression coverage for this bug.
  The failing case must start from no worktree.
- Surface a named error instead of a bare `invalid_params: ENOENT` when a routing
  read fails — the generic catch-all at `daemon.ts:471` hid a launch-blocking bug
  behind a params error for a full release cycle.

## Out of scope

- Live pause/kill for workflow-started implement runs.
- The `daemon.ts` catch-all's other callers.

## Documentation updates

- `v2/docs/operator-runbook.md` — the "`--spec` for implement is resolved against
  the registered project root" note is currently aspirational; confirm it once the
  runner agrees with the preflight.
- `v2/docs/write-behavior.md` — record when the worktree is created relative to the
  first routing read.

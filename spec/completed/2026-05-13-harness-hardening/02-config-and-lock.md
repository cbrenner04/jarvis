# 02 — Atomic config writes and worktree lock

## Problem

Two concurrency hazards:

1. `~/.jarvis/config.json` is read-modify-written non-atomically by
   `setProjectOrigin`, `registerProject`, `setProjectGit`, `setGit`. Two
   processes (e.g. `jarvis run` doing a lazy-origin backfill while
   `jarvis init` registers a new project) can overlap and the later writer
   clobbers the earlier one's mutation. Probability is low; the loss is a
   silently missing registry entry, which is annoying to diagnose.
2. `jarvis run` does not prevent two instances from operating on the same
   `.worktree/<name>` directory. Today the user-facing convention is "don't
   do that," but `git add -A` in commit paths means one instance can stage
   the other's in-progress edits. Two instances against the same spec
   should be refused with a clear message.

## Behavior

**Atomic config writes.** Replace `writeFileSync(file, ...)` in
`src/config.ts` with: write to `${file}.tmp.<pid>.<rand>`, `fsync`,
`renameSync` over `file`. Add a single in-process mutex so two concurrent
writes in the same process serialize. Cross-process protection comes from
the rename being atomic; concurrent writers can still both produce a final
state where one mutation is lost, but the file cannot end up partially
written or syntactically broken.

**Worktree lock.** When `runCommand` enters the worktree, write
`<worktree>/.jarvis.lock` containing `{ pid, started_at, host }` JSON. On
exit (any path, including abort), remove the file. Before writing, if the
lock already exists:

- Read it. If the recorded pid is alive on the current host
  (`process.kill(pid, 0)` succeeds), refuse with a clear message naming the
  pid and started_at, exit code `9` ("worktree busy").
- If the pid is gone, auto-clear the stale lock and proceed. Log a single
  `harness` line noting the recovery.

The lock file is not committed; add to `.gitignore` if not already covered
by `.worktree/` being a runtime directory. `jarvis triage <name>` reports
lock state.

## Tasks

- [ ] Implement atomic write helper in `src/config.ts`; use it everywhere
      that currently calls `writeFileSync(file, serialize(...))`.
- [ ] In-process write mutex covering all config mutation paths.
- [ ] Implement lock acquire/release around the iteration loop in
      `src/modes/patch/run.ts`. Ensure release runs on every exit path,
      including abort/SIGINT (subspec 01 plumbing).
- [ ] Add exit code `9` to `docs/run-loop.md`.
- [ ] `jarvis triage <name>` shows lock state (held/stale/none).
- [ ] Tests: simulated concurrent config write does not produce a
      truncated file; stale lock is auto-cleared; live lock refuses with
      exit `9`.

## Acceptance criteria

- [x] Crashing mid-write (simulated) leaves the previous `config.json`
      intact (atomic rename).
- [x] A worktree with a stale lock (pid no longer running) is cleared
      automatically by the next `jarvis run` and a harness log line names
      the recovered pid.
- [x] A worktree with a live lock causes `jarvis run` to exit `9` with a
      message that names the holding pid and the start time.
- [x] `jarvis triage <name>` shows the lock state.
- [x] `docs/run-loop.md` documents exit code `9`.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- `docs/run-loop.md`: exit code `9`.
- `docs/worktrees-and-commits.md`: lock file location, recovery semantics.

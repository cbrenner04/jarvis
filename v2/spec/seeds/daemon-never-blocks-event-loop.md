# Daemon must never block its event loop

The v2 daemon is a single-threaded event loop that hosts every run in-process
(`spawnWriteLoop`, `daemon.ts:343`) alongside every IPC handler (`list`, `wait`,
`tail`, TUI polls). Any synchronous shell-out inside a run's path is a
stop-the-world for the whole daemon.

## Problem

The completion ready gate is `execFileSync("bun", ["run", "ready"])`
(`v2/src/execution/ready-finalize.ts:35`). During the gate — minutes of tests and
lint — the daemon serves nothing: `jarvis run list` hangs, `jarvis run log`
streams nothing, `jarvis tui` freezes. Observed while dogfooding.

It is not the only one. All of these run `execFileSync` on the daemon's loop:

- `ready-finalize.ts:35` (`bun run ready`), `:45` (`gh pr ready`, retried 3x)
- `completion-publisher.ts:41` (`git`, incl. `git push`), `:45` (`gh pr create/view`), `:50` (`gh auth status`)
- `pr-body-refresh.ts:39`, `:48` (`gh pr view` / `gh pr edit`)
- `shared/subprocess.ts:11` — the shared runner behind `external-worktree.ts`
  (`git worktree add`, `prune`, `rev-parse`) and `shared/git.ts` (`gh repo view`)
- `shared/git.ts` `isWorktreeDirty`, called **directly from the `revise`/`resume`
  RPC handler** (`daemon.ts:319`)

Agent invocation itself is already correctly async (`spawn`, `shared/invocation/agents.ts`),
so the LLM turns yield. It is specifically the git/gh/gate shell-outs that freeze it.

## Scope

- Convert the ready gate and every subprocess call on a daemon-hosted path to
  async (`execFile`/`spawn` + promise), so IPC stays responsive while a run
  shells out. `shared/subprocess.ts` is the shared seam — its async form must
  serve both v1 and v2 callers.
- **A robust guard that keeps it async.** A one-time conversion decays; the point
  is that the next `execFileSync` cannot land. Pick a mechanism in Decisions.
- Prove it: a test that issues `list`/`tail` while a run is inside the gate and
  asserts the daemon answers within a bound.

## Decisions

- Guard mechanism — recommend a **lint rule** (Biome `noRestrictedImports` /
  restricted-syntax banning `*Sync` from `node:child_process` and blocking `fs`
  sync calls) scoped to `v2/src/**` and `shared/**` daemon-reachable modules,
  with an explicit allowlist for CLI-only entrypoints. A test-only guard catches
  less; a code review guard catches nothing.
- Short sync `fs` calls (`existsSync`, `readFileSync` on small config/spec files)
  are not the problem and need not all convert — but they must be a deliberate,
  allowlisted exception, not an accident.
- v1 must keep working: `shared/subprocess.ts` changes are additive or migrate
  both callers.

## Out of scope

- Moving runs out-of-process (worker threads / subprocess-per-run). That may be
  the right long-term shape but is a much larger change; async-ing the shell-outs
  fixes the observed failure.
- Cancelling an in-flight gate.

## Documentation updates

- `v2/docs/daemon-host.md` — the daemon-never-blocks invariant and the guard.
- `v2/docs/coding-standards.md` — no sync subprocess on daemon paths.

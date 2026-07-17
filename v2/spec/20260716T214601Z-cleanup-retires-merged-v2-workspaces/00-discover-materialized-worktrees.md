# 00 - Discover materialized worktrees

## Problem

Cleanup must find v2 worktrees under `~/.jarvis/worktrees/<project>/` for each registered project —
including slash-nested branch paths (`plan/foo`, `intent/bar`) — before it can consider retiring any.
It must not mistake the `plan/` and `intent/` **parent** directories (which are empty) or leftover
non-worktree debris for candidates.

**Attempt 5 (#1694) shipped discovery as a permanent no-op** and it passed every test. The worktree
check ran `runner.runAsync("git", ["rev-parse","--is-inside-work-tree"], path, { stdio: "ignore" })`
and compared the result to `"true"` — but `realAsyncSubprocessRunner` resolves stdout to `""` under
`stdio: "ignore"` (`shared/subprocess.ts:11`), so the compare was `"" === "true"` → always false →
discovery returned `[]` for every real worktree. Driving the real CLI on disk returned "No eligible
worktrees to clean up" with five merged worktrees present. The suite stayed green because the test
mock returned `"true\n"` regardless of the `stdio` option. **The stdout the check depends on must be
captured, and the test that proves discovery works must use `realAsyncSubprocessRunner` against a
real `git worktree add`, not a hand-rolled mock.**

## Decisions

- Take the worktrees home as an injectable `jarvisRoot`, defaulting to `jarvisHome()` exactly as
  `getExternalWorktreePath` does (`v2/src/execution/external-worktree.ts:47`); rules out resolving
  `~/.jarvis` internally, which leaves no seam.
- A directory is a candidate only when it is a real git worktree (has a `.git` file/dir pointing at
  the registration), resolving its branch; rules out treating an empty directory or arbitrary debris
  as a worktree.
- The worktree check must read real command output: any subprocess call whose stdout it inspects runs
  **without** `stdio: "ignore"` (which resolves to `""` and makes the check a constant-false no-op);
  rules out attempt 5's dead compare. Prefer inspecting the `.git` entry directly, or capture stdout.
- Discovery is a pure function over the filesystem — no PR, run, or daemon inspection here; those are
  the eligibility gate's job (`01-eligibility-gate.md`). Rules out coupling discovery to ownership.
- Handle each registered project independently, walking nested branch paths; rules out flattening to
  a single project or missing `plan/<name>` depth.

## Acceptance criteria

- [ ] A discovery function takes an injectable `jarvisRoot` (default `jarvisHome()`) and the project
  registry, and returns one candidate per real worktree under `~/.jarvis/worktrees/<project>/`,
  each carrying its absolute path and resolved branch (including slash-nested `plan/<name>`).
- [ ] `v2/src/commands/cleanup.test.ts` drives discovery **through `realAsyncSubprocessRunner`** (not
  a hand-rolled git mock) against a temp `jarvisRoot` holding **real materialized worktrees** (create
  them with `git worktree add`), asserts a non-empty candidate set, and asserts the branch is resolved
  for a slash-nested path. This test must fail if the worktree check is a constant-false no-op (e.g.
  restoring `stdio: "ignore"` on a stdout-inspecting call turns it red).
- [ ] Empty directories — specifically the `plan/` and `intent/` parents — and non-worktree
  directories are excluded. A test materializes a real worktree beside an empty `plan/` dir and a
  bare non-git dir and asserts only the real worktree is returned.
- [ ] `bun run check`, `bun run typecheck`, and `bun run test:v2` pass.

## Documentation updates

- None on its own; the CLI contract is documented in `02-cleanup-command-and-dry-run.md`.

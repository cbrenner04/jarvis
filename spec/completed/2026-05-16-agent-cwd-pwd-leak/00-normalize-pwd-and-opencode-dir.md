# 00 — Normalize `PWD` and pass `--dir` for spawned agents

## Problem

`src/agents/spawn.ts` spawns each agent CLI with `cwd: config.cwd` but
inherits `process.env` unchanged. Node does not rewrite `PWD` to match
the new cwd. When jarvis's own `PWD` points at the parent project repo
(the common case — the operator runs `jarvis run` from the project root
even though the worktree lives at `<project>/.worktree/<spec>/`), the
agent sees:

- `process.cwd()` → the worktree (correct)
- `process.env.PWD` → the parent project repo (stale, wrong)

Any agent that reads `PWD` instead of `process.cwd()` (confirmed for
`opencode` 1.15.x at `packages/opencode/src/cli/cmd/run.ts:282`) treats
the parent as its working directory. With `opencode` specifically, the
SDK sets `x-opencode-directory` to the `PWD` value on every request, the
in-process server middleware loads a second project instance for the
parent repo, and the session is stored against the parent. All file-edit
tool calls then land in the parent's working tree instead of the
worktree.

Symptom in the run terminal: subspec commits push successfully but
contain only `index.md` + the subspec's checkbox flips. The draft PR
diff has no source-code changes. The operator's parent checkout grows a
pile of uncommitted edits across iterations.

## Decisions

- **Fix at the harness spawn layer**, not in any per-agent shim. The bug
  is a generic shell/Node convention mismatch; any current or future
  agent that reads `PWD` would hit it. The fix is one edit in
  `src/agents/spawn.ts`.
- **Normalize `PWD`** to match the spawned process's cwd. In
  `src/agents/spawn.ts`, pass `env: { ...process.env, PWD: config.cwd }`
  to `child_process.spawn`. Also unset `OLDPWD` (delete the key from the
  forwarded env) so an agent that reads `OLDPWD` cannot trip the same
  trap.
- **Belt-and-suspenders for `opencode`.** Add `--dir <cwd>` to the
  `opencode` argv in `src/agents/opencode.ts`. `opencode run` calls
  `process.chdir(args.dir)` early and uses the result as the directory
  for every SDK request, bypassing the `PWD` read path entirely. This is
  defense-in-depth in case some future change to opencode reintroduces
  the `PWD` read on a path the env-var fix does not cover. `--dir` is
  documented (`opencode run --help`) and stable.
- **No worktree relocation.** Moving worktrees out of
  `<project>/.worktree/<spec>/` (e.g. to `~/.jarvis/worktrees/<spec>/`)
  would also avoid the issue for opencode-specific project resolution,
  but is a much larger change with cross-cutting impact on path
  resolution, the lock file, log routing, and the cleanup command. We
  explicitly keep the existing worktree layout and fix only the env-var
  leak.
- **No change to other agent shims.** `claude`, `codex`, and `cursor`
  have not been observed exhibiting this bug. The harness-level `PWD`
  normalization protects them passively without requiring per-agent
  flag changes.

## Tasks

1. In `src/agents/spawn.ts`, pass an explicit `env` to `spawn` that
   forwards `process.env`, overwrites `PWD` with `config.cwd`, and
   deletes `OLDPWD`. Do not introduce a separate helper for one call
   site.
2. In `src/agents/opencode.ts`, prepend `--dir`, `opts.cwd` to the
   `buildArgv` return value, before `--model`. Keep the existing
   positional `prompt` last so the opencode CLI argument shape stays
   `opencode run [flags] <prompt>`.
3. Add a unit test in `test/agents/spawn.test.ts` (create the file if
   it does not exist) that spawns a tiny helper binary which prints
   `process.env.PWD` and asserts it equals the `cwd` passed to
   `runAgent`. The helper can be `node -e 'process.stdout.write(process.env.PWD ?? "")'`
   or a one-line bun script; whichever is already in use by the
   existing spawn tests, follow that pattern.
4. Add a unit test in `test/agents/opencode.test.ts` (create or extend)
   that constructs an `OpencodeAgent`, calls a stubbable seam (or
   inspects the argv built by `buildArgv`) and asserts the argv
   contains `--dir <cwd>` in front of `--model`.
5. Update `docs/agents.md` to reflect the new opencode argv (the row in
   the supported-agents table that says
   `opencode run --model <provider/model> --format default <prompt>`
   becomes
   `opencode run --dir <cwd> --model <provider/model> --format default <prompt>`)
   and add a one-sentence note in the same section that jarvis
   normalizes `PWD` for every spawned agent so agents that read `PWD`
   (e.g. opencode) operate on the worktree, not the parent repo.

## Acceptance criteria

- [x] `src/agents/spawn.ts` passes `env` to `child_process.spawn` with
  `PWD` set to `config.cwd` and `OLDPWD` removed; all other env keys
  inherited from `process.env`.
- [x] `src/agents/opencode.ts` `buildArgv` returns
  `["run", "--dir", opts.cwd, "--model", this.#model, "--format", "default", prompt]`
  (the exact order may vary as long as `--dir` precedes the prompt and
  is a separate token from its value).
- [x] A new test asserts the spawned child's `PWD` equals the cwd
  jarvis configured, not the harness's own `PWD`.
- [x] A new or extended opencode test asserts the argv contains
  `--dir` followed by the configured cwd.
- [x] `docs/agents.md` reflects the new opencode argv and mentions
  the harness-level `PWD` normalization.
- [x] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- `docs/agents.md`: update the `opencode` row in the supported-agents
  table to show `--dir <cwd>` in the invocation, and add one sentence
  noting that jarvis normalizes `PWD` for every spawned agent.
- No changes to `README.md`, `AGENTS.md`, `docs/run-loop.md`,
  `docs/worktrees-and-commits.md`, `docs/spec-guidance.md`,
  `docs/plan-mode.md`, `docs/quota-signals.md`, or `docs/config.md`.

## Out of scope

- Relocating worktrees outside the parent repo (e.g. under
  `~/.jarvis/worktrees/`).
- Auditing `claude`, `codex`, or `cursor` for similar `PWD`-reading
  bugs; the harness-level fix protects them passively.
- Detecting and rolling back the dirty-parent-repo state from past
  buggy runs. Operators clean up manually with `git reset --hard` and
  `git clean -fd` in the parent checkout.

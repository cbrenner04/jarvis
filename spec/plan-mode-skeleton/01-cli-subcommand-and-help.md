# 01 — `jarvis plan` subcommand and help

## Problem

`jarvis` currently recognizes `run`, `init`, `config`, `log-server`,
`cleanup`, `triage`, and `help`. Unknown subcommands print usage and exit
non-zero. Adding `plan` requires registering a new subcommand in the CLI
dispatcher, providing usage text, and ensuring `jarvis help` and the
top-level usage message list it.

This subspec lands the dispatcher entry, help text, and a stub
implementation that always exits with the "not yet implemented" message.
Argument parsing for the various input forms is added in subspec 02.

## Decisions

- **New file `src/commands/plan.ts`** exporting `planCommand(opts)`. Mirrors
  the shape of `runCommand` and `triageCommand`: takes `{ projectRoot, io,
  config, args }`, returns a `Promise<number>` exit code.
- **CLI wiring in `src/cli.ts`** registers `plan` alongside the existing
  subcommands. Unknown flags after `plan` follow the existing dispatcher's
  error path.
- **Stub body.** For this subspec the function ignores its input beyond
  basic shape validation and writes the uniform stub message to stderr,
  returning exit code `2`. Subspec 02 replaces the body with real argument
  parsing.
- **Help text.** Both `jarvis help` and `jarvis plan --help` (or `jarvis
  plan -h`) print the same usage block:

  ```text
  jarvis plan [--interview-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [<intent-file-or-text>]
                              Generate a spec tree from an intent. (planning behavior arrives in later specs)
  ```

  The single-line summary in `jarvis help`'s command list reads `Generate
  a spec tree from an intent.`
- **No flag is consumed in this subspec.** Help text advertises the full
  surface so reviewers can see the planned shape; subspec 02 makes the
  parser actually accept and route them.

## Implementation hints

- Look at how `triageCommand` is exported and registered in `src/cli.ts`
  for the most recent pattern.
- The stub message constant should live in `src/commands/plan.ts` and be
  reused by subspec 02 so all stub exit paths stay consistent until they
  are replaced.

## Tasks

- [ ] Create `src/commands/plan.ts` with `planCommand` and a `PlanIo` type
  (`stdout`, `stderr`).
- [ ] Wire `jarvis plan` in `src/cli.ts`, including `--help`/`-h` handling
  on the subcommand.
- [ ] Add `plan` to the `jarvis help` command list with the one-line
  description.
- [ ] Stub body writes the "not yet implemented" message to stderr and
  returns exit code `2`.
- [ ] Tests in `src/commands/plan.test.ts` covering: `jarvis plan` exits
  `2` with the stub message; `jarvis plan --help` exits `0` and prints
  usage; unknown subcommand handling is unaffected.
- [ ] `jarvis help` snapshot/output test (or the equivalent of the current
  pattern) updated to include the new line.

## Acceptance criteria

- [x] `jarvis plan` (no args) prints the stub message to stderr and exits
  with code `2`.
- [x] `jarvis plan --help` and `jarvis plan -h` print the usage block to
  stdout and exit `0`.
- [x] `jarvis help` lists `plan` with a one-line description.
- [x] No worktree, file, branch, commit, or PR is created or modified by
  any invocation.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. README and docs updates land in subspec 06 of this same spec.

# 03 — CLI entrypoint

Wire up the `jarvis` binary and subcommand dispatch. Subcommand bodies are stubs at this stage; later subspecs flesh them out.

## Tasks

- [ ] `src/cli.ts` — argv parser. No external dep unless trivially small; hand-rolled is fine for a fixed subcommand set.
- [ ] Subcommands: `run <spec-path>`, `init`, `config`, `help`. Unknown subcommand → print help to stderr, exit 1.
- [ ] `bin/jarvis` shebang script that execs `bun run <repo>/src/cli.ts "$@"` (resolved relative to the script).
- [ ] `package.json` `bin` field points at `bin/jarvis`.
- [ ] Each subcommand stub prints `not yet implemented` and exits 0 (so 04+ can replace them one at a time).
- [ ] `loadConfig()` is called once at the top of `run`/`init`/`config` to ensure the config dir is bootstrapped on every invocation.
- [ ] Tests: argv parsing (subcommand routing, help, unknown-subcommand exit code). Subprocess tests of `bin/jarvis` are not required.

## Acceptance criteria

- `bun run src/cli.ts help` prints usage including all subcommands.
- `bun run src/cli.ts run ./somewhere.md` reaches the `run` stub without error.
- `bun run src/cli.ts bogus` exits 1.

## Documentation updates

- Add a "Usage" section to `README.md` listing the subcommands and their argument shapes.

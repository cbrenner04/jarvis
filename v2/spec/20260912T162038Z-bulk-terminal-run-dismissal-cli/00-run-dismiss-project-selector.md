# `run dismiss --project <name>`

## Problem

`jarvis run dismiss` takes exactly one run ID (`parseRunDismissalArgs` in `v2/src/commands/run.ts` rejects anything but a single positional), so clearing a project's terminal rows means piping `run list` output into repeated commands. Default `run list` shows only the fifty newest terminal rows, so each pass exposes older rows and the project looks like it never shrinks. The daemon `dismiss` handler and `store.dismissTerminalRunsForProject` already implement the bulk path; only the CLI cannot reach it.

## Behavior

`jarvis run dismiss --project <name>` sends one `dismiss` request carrying `{ project }`, and prints the daemon's dismissed-row count. Terminal rows for the exact project — including terminal workflow step rows — are dismissed; nonterminal rows are untouched. A positional run ID together with `--project` is refused before any RPC. `jarvis run undismiss` keeps its single-ID grammar.

## Decisions

- Refuse the combined positional-plus-`--project` form in CLI argument parsing with a named error, before opening a daemon client; rules out relying on the daemon's `invalid_params` round trip.
- Send `{ project }` alone (no `runId` key) on the bulk request; rules out sending both keys with an undefined/empty `runId`, which the daemon's exclusivity check would reject.
- Parse the bulk response as `{ kind: "applied", dismissedCount }` separately from the single-ID `RunDismissalOutcome` parser, which requires `runId`; rules out loosening that parser and weakening single-ID validation.
- `--project` matches exactly, mirroring `run list --project`; selection happens in the daemon/store, so it reaches rows beyond list retention. Rules out a client-side list-and-loop.
- Bulk undismiss and `pipeline dismiss --project` stay out of scope.

## Acceptance criteria

- [ ] A test in `v2/src/commands/run.test.ts` proves `run dismiss --project <name>` issues exactly one `dismiss` request whose params carry the project and no `runId`, and fails against the pre-fix single-positional signature.
- [ ] A test in `v2/src/commands/run-dismiss-project.test.ts` drives the real daemon handler over a seeded store and proves every terminal row for the project — standalone and workflow step rows — becomes dismissed while in-progress, queued, and paused rows stay undismissed.
- [ ] A test asserts bulk dismissal writes the daemon-reported dismissed-row count to stdout and exits zero.
- [ ] A test asserts a positional run ID combined with `--project` exits non-zero with a named error on stderr and opens no daemon client.
- [ ] `v2/src/cli/usage.ts` documents both the positional and `--project` forms in the `run dismiss` usage string, and a usage test asserts it.
- [ ] `v2/src/cli/command-tree.ts` lists `--project` under `run dismiss` help, and the help-flags parity test stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — bulk project dismissal, its terminal/workflow-step scope, the count output, and why the default fifty-terminal-row list window makes repeated single-row dismissal look like the list refills.
- `v2/docs/write-behavior.md` — `run dismiss` grammar, exclusive selector admission, request params, output, and exit semantics.
- `v2/docs/v1-behaviors.md` — record the operator-facing bulk dismissal behavior.

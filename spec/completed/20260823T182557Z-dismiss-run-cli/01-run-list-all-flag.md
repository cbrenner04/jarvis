# `run list --all` includes dismissed runs

## Problem

`runListSubcommand` (`v2/src/commands/run.ts`) builds its `list` params from `--since`/`--limit`/`--project`/`--branch`/`--spec`/`--status` only, so it always takes the daemon's default projection. Since `dismiss-run-rpc` landed, that projection excludes runs with a non-null durable `dismissedAt`, and there is no CLI way back in: once `00` ships `run dismiss`, a dismissed run is invisible to `jarvis run list` under every filter combination even though the daemon accepts `includeDismissed: true` and every row already carries `dismissedAt`.

## Decision ledger

- `--all` is a flag on `run list`, not a `run list-dismissed` command — it composes with the existing `--since` and dimension filters; rules out a second listing command that would have to re-implement filtering, socket merging, and rendering.
- `--all` widens the **request** (`includeDismissed: true`) rather than post-filtering a wider default — rules out sending the opt-in unconditionally and filtering client-side, which would silently change what every `jarvis run list` invocation asks each daemon for.
- Without `--all` the request stays byte-identical to today's: `resolveListRpcRequest` omits the key entirely, and a bare `run list` still issues `list` with no params at all — rules out sending `{ includeDismissed: false }`, which is behaviorally equal but re-pins the wire shape for no gain.
- `--all` is not a filter field: `listRpcRequestIsFiltered` (`v2/src/commands/run-list-rpc.ts`) already ignores `includeDismissed`, so bare `run list --all` keeps the fifty-newest terminal retention path instead of switching to the 200-row filtered path — rules out treating `--all` as a seventh dimension filter, which would change the row set of an otherwise unfiltered listing.
- The human listing marks dismissal with a trailing column (`dismissed`, or `-` when not dismissed) rendered **only** under `--all`, appended after the existing trailing `completionCommitError` column — rules out an always-present column, which would break every existing column-count parser, and rules out inserting the marker mid-row.
- The marker predicate keys off `typeof dismissedAt === "number"`, not `dismissedAt !== null` — the wire field is optional (`DaemonListRunRow.dismissedAt?: number | null`), so a row that omits it must render `-`; rules out misrendering an absent field as dismissed.
- No `--json` output mode lands here: `jarvis run list` has no `--json` flag on the base, so the intent's `run list --all --json` verification is dropped and the phantom `--json` references in `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` are corrected in place — rules out inventing a run-list JSON surface inside a dismissal spec (see the index premise correction).
- `--all` is not a superset of the default listing: the daemon applies the dismissal filter before terminal retention, so under `includeDismissed: true` dismissed terminal rows compete for the same fifty-newest retention slots as never-dismissed ones — `run list --all` can therefore omit a row that plain `run list` shows. This is existing daemon-side behavior, not something this subspec's tests exercise; the runbook AC below states the caveat.
- This subspec and the sibling `dismiss-run-tui-display` intent both amend the same `v2/docs/v1-behaviors.md` dismissed-exclusion entry — plan/run them serially against each other's merged result, not in parallel off a shared base, per this repo's same-seam-sibling rule.
- The list-side half of the intent's round trip (`list` omits a dismissed run by default, `list --all` shows it, `undismiss` restores it to default `list`) stays pinned daemon-side in `v2/src/daemon/daemon-run-dismiss.test.ts`; this subspec's tests pin the CLI request/rendering contract only — rules out re-asserting daemon-side filtering through canned CLI stub frames.

## Task checklist

- Add `all: { type: "boolean" }` to `RUN_LIST_PARSE_ARG_OPTIONS` (widening its `satisfies` clause to `{ type: "boolean" | "string" }`) and a matching `--all` entry to `RUN_LIST_HELP_FLAGS` in `v2/src/cli/command-help-flags.ts` (`help-flags-parity.ts` already walks `run list`).
- Update `RUN_LIST_USAGE` in `v2/src/cli/usage.ts` for the new flag.
- Carry `all` through `parseListArgv` into `ListRpcParams.includeDismissed`, and into `formatListRunRow` in `v2/src/commands/run.ts`.
- Extend `v2/src/commands/run.test.ts` with the tests below and their in-body `// @mutate` directives, plus the `help run list` flag assertion.
- Update `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and the `list` row prose in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [x] A CLI test drives `run list --all` and asserts the issued `list` frame carries `includeDismissed: true`; it fails against the pre-fix CLI, whose strict `parseArgs` rejects `--all` with `RUN_LIST_USAGE` and exit `1` before connecting.
- [x] A CLI test drives `run list --all` over a response holding one dismissed row (numeric `dismissedAt`) and one not (`dismissedAt: null`) and asserts the rendered rows carry a trailing `dismissed` marker on the first and `-` on the second, with every other column unchanged.
- [x] A CLI test drives `run list` without `--all` and asserts the issued `list` frame carries no params at all, matching today's request shape.
- [x] A CLI test drives `run list` without `--all` over a response holding a row with a numeric `dismissedAt` and asserts the rendered row keeps exactly today's column set with no trailing dismissal marker.
- [x] A CLI test drives `run list --all --since <duration> --project <name>` and asserts one `list` frame carrying `includeDismissed: true` alongside the resolved `sinceMs` and `project` params — the opt-in composes with the existing filters.
- [x] The existing `run list` multi-daemon merge, sort, and column-rendering tests in `v2/src/commands/run.test.ts` stay green unmodified (default output and request shape unchanged by the flag).
- [x] `help run list` prints the updated usage line and shows `--all` alongside the existing filter flags, and `v2/src/cli/help-flags-parity.test.ts` stays green with the new parser flag.
- [x] `v2/src/commands/run.test.ts` — `run list --all requests dismissed runs`; Keystone checkpoint: an in-body `// @mutate` directive neutering the `--all` opt-in assignment so `includeDismissed` is never set (baseline: `list` is always requested without the opt-in and dismissed runs are unreachable from the CLI) turns this test red.
- [x] `v2/src/commands/run.test.ts` — `run list without --all omits the includeDismissed opt-in`; Mutation checkpoint: an in-body `// @mutate` directive making the same assignment unconditional makes the default listing request dismissed runs too, turning this test red — the negative case proving the flag, not the command, opts in.
- [x] `v2/src/commands/run.test.ts` — `run list --all marks dismissed rows`; Mutation checkpoint: an in-body `// @mutate` directive replacing the conditional dismissal-column spread with an empty spread drops the marker from `--all` rows, turning this test red.
- [x] `v2/src/commands/run.test.ts` — `run list without --all renders no dismissal column`; Mutation checkpoint: an in-body `// @mutate` directive replacing the same conditional spread with an unconditional one appends the marker column to default rows, turning this test red — the negative case proving the column is suppressed without `--all`.
- [x] `v2/docs/write-behavior.md` — the Run control CLI table records `run list --all` (request-level `includeDismissed: true` opt-in, composable with `--since` and the dimension filters, not itself a filter field so it does not switch an unfiltered listing to the filtered path), the `--all`-only trailing `dismissed`/`-` column after `completionCommitError`, and that the default listing's request and column set are unchanged.
- [x] `v2/docs/operator-runbook.md` — the `jarvis run list` command table gains a `--all` row describing it as the way to see dismissed runs, its composition with `--since`/dimension filters, the trailing dismissal column, and the caveat that `--all` competes dismissed rows for the same fifty-newest retention slots as everything else, so it is not guaranteed to be a superset of the default listing.
- [x] `v2/docs/v1-behaviors.md` — the `[v2 behavior change]` entry recording the default dismissed-exclusion is amended in place to name `jarvis run list --all` as the CLI opt-in and its `--all`-only dismissal column, to record that `jarvis run list` no longer prints every retained run by default, and to drop its reference to a `jarvis run list --json` flag that does not exist.
- [x] `v2/docs/daemon-host.md` — the `list` row's display-caller sentence names the real default-exclusion adopters (`jarvis run list` and the TUI) instead of the phantom `--json`, and records `run list --all` as the CLI `includeDismissed: true` opt-in.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — Run control CLI table rows for `--all`, the dismissal column, and the unchanged default request.
- `v2/docs/operator-runbook.md` — `jarvis run list --all` in the run-listing command table, incl. the not-a-superset retention caveat.
- `v2/docs/v1-behaviors.md` — the dismissed-exclusion entry amended to name the `--all` opt-in and drop the phantom `run list --json`.
- `v2/docs/daemon-host.md` — corrected display-caller list on the `list` RPC row.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive (escape inner quotes as `\"` inside a directive):

  ```ts
  if (values.all === true) params.includeDismissed = true;
  ```

  ```ts
  ...(showDismissal ? [typeof run.dismissedAt === "number" ? "dismissed" : "-"] : []),
  ```

  The first is the keystone anchor (replaced by `if (false) params.includeDismissed = true;`) and the default-request guard anchor (replaced by the unconditional `params.includeDismissed = true;`); the second is the marker anchor (replaced by `...[],` and by the unconditional `...[typeof run.dismissedAt === \"number\" ? \"dismissed\" : \"-\"],`). Each must occur exactly once in `run.ts`.
- `formatListRunRow` takes the `--all` boolean as a second parameter; `runListSubcommand` already holds the parsed params, so thread the flag from `parseListArgv`'s result rather than re-reading argv at the render site.
- `--all` is boolean, so it belongs in `RUN_LIST_PARSE_ARG_OPTIONS` but not in `LIST_VALUE_FLAGS` / `LIST_FLAG_INVALID_MESSAGE`, which drive the missing-value diagnostics for value flags only. `parserAcceptedLongFlags(["run","list"])` derives from `Object.keys(RUN_LIST_PARSE_ARG_OPTIONS)`, so the parity guard picks the flag up automatically once the help flag is registered.
- `resolveRunOwnerSocket` already passes `{ includeDismissed: true }` on its own `list` query; leave it alone — that is run-owner routing, not display.
- Merged rows come from `mergeRunLists`, which carries whole rows through, so `dismissedAt` reaches the renderer unchanged on the multi-daemon path.

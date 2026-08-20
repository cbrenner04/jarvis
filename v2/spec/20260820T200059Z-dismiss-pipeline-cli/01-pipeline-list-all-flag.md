# `pipeline list --all` includes dismissed pipelines

## Problem

`runPipelineListCommand` (`v2/src/commands/pipeline.ts`) issues `request(client, "pipeline_list")` with no parameters, so it always takes the daemon's default projection. Since `dismiss-pipeline-rpc` landed, that projection excludes dismissed pipelines and there is no CLI way back in: a dismissed pipeline is invisible to `pipeline list`, `pipeline list --json`, and every filter combination, even though the daemon accepts `includeDismissed: true` and every snapshot already carries `dismissedAt`.

## Decision ledger

- `--all` is a flag on `pipeline list`, not a `pipeline list-dismissed` command — it composes with the existing `--since`/`--state` filters and with `--json`; rules out a second listing command that would have to re-implement filtering and rendering.
- `--all` widens the **request** (`includeDismissed: true`) rather than post-filtering a wider default — rules out sending the opt-in unconditionally and filtering client-side, which would silently change what every `pipeline list` invocation asks the daemon for.
- Without `--all` the request stays byte-identical to today's parameterless `pipeline_list` — rules out sending `{ includeDismissed: false }`, which is behaviorally equal but re-pins the wire shape for no gain.
- `--all` is accepted alongside `--json`; only `--since`/`--state` remain incompatible with `--json` — rules out extending the `--json` incompatibility set, since `--all` changes the request the snapshot comes from rather than post-processing it.
- `--all` does not touch the existing `--json` + `--since`/`--state` incompatibility check: `pipeline list --json --all --since <duration>` (or `--state`) still hits the same usage error and exit `1` as `pipeline list --json --since`/`--state` do today, since that check only inspects `since`/`state` — rules out `--all` implicitly becoming a third flag exempted from the check.
- The human listing marks dismissal with a trailing seventh column (`dismissed`, or `-` when not dismissed) rendered **only** under `--all` — rules out folding the marker into the `state` column, which `write-behavior.md` pins as the daemon value verbatim and which `--state` filters on; rules out an always-present column, which would change every existing row.
- `--json` prints the widened snapshot unmodified, marker included only as the existing `dismissedAt` field — rules out injecting a synthetic marker field into JSON output.
- Local `--since`/`--state` filtering applies to the widened set unchanged, after the daemon's inclusion decision — rules out special-casing dismissed rows out of the filters.
- The list-side half of the intent's round-trip verification (`list` omits a dismissed pipeline by default, `list --all` shows it, `undismiss` restores it to default `list`) is covered daemon-side per `00`'s ledger (`v2/src/daemon/daemon-pipeline-dismiss.test.ts`); this subspec's tests pin the CLI request/response/rendering contract only.
- A fully-dismissed default listing still prints today's `No pipelines.` with no hidden-count hint — an accepted ambiguity; a count would require a daemon-side change, out of this CLI-only spec's scope (see index scope note) — rules out inventing a client-side hidden-count message here.

## Task checklist

- Add `all: { type: "boolean" }` to `PIPELINE_LIST_PARSE_ARG_OPTIONS` and a matching `--all` entry to `PIPELINE_LIST_HELP_FLAGS` in `v2/src/cli/command-help-flags.ts` (`help-flags-parity.ts` already walks `pipeline list`).
- Update `PIPELINE_LIST_USAGE` in `v2/src/cli/usage.ts` for the new flag.
- Carry `all` through `PipelineListCliInput` / `parsePipelineListArgs`, into the `pipeline_list` request params, and into `renderPipelineListRows` in `v2/src/commands/pipeline.ts`.
- Extend the `describe("pipeline list")` block in `v2/src/commands/pipeline.test.ts` with the tests below and their in-body `// @mutate` directives, and extend the existing `help pipeline list matches list usage and shows filter flags` test with `--all`.
- Update `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [x] A CLI test drives `pipeline list --all` and asserts the single `pipeline_list` frame carries `{ includeDismissed: true }`; it fails against the pre-fix CLI, whose strict `parseArgs` rejects `--all` with `PIPELINE_LIST_USAGE` and exit `1` before connecting.
- [x] A CLI test drives `pipeline list --all` over a snapshot holding one dismissed pipeline (numeric `dismissedAt`) and one not (`dismissedAt: null`) and asserts the human rows carry a trailing `dismissed` marker on the first and `-` on the second, with every other column unchanged.
- [x] A CLI test drives `pipeline list` without `--all` and asserts the `pipeline_list` frame carries no params at all.
- [x] A CLI test drives `pipeline list` without `--all` and asserts each rendered row has exactly the six existing tab-separated columns with no trailing dismissal marker.
- [x] A CLI test drives `pipeline list --json --all` and asserts exit `0`, the `{ includeDismissed: true }` request, and stdout equal to the daemon snapshot serialized unmodified (`dismissedAt` present, no synthetic marker field).
- [x] A CLI test drives `pipeline list --all --since <duration> --state <state>` and asserts the local filters still select rows out of the widened set, with the dismissal marker rendered on the survivors.
- [x] A CLI test drives `pipeline list --json --all --since <duration>` and asserts the same `PIPELINE_LIST_USAGE`-on-stderr, exit-`1` refusal (before connecting) as `pipeline list --json --since <duration>` today — `--all` does not lift the existing `--json`+filter incompatibility.
- [x] The existing `list renders one human row per pipeline` and `list --json preserves the unmodified pipeline_list snapshot` tests in `v2/src/commands/pipeline.test.ts` stay green unmodified (default output and request shape unchanged by the flag).
- [x] `help pipeline list` prints the updated usage line and shows `--all` alongside `--json`, `--since`, and `--state`, and `v2/src/cli/help-flags-parity.test.ts` stays green with the new parser flag.
- [x] `v2/src/commands/pipeline.test.ts` — `list --all requests dismissed pipelines`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the request params expression to always send `undefined` (baseline: `pipeline_list` is always requested parameterless and dismissed pipelines are unreachable) turns this test red.
- [x] `v2/src/commands/pipeline.test.ts` — `list without --all requests the parameterless snapshot`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the same request params expression to always send `{ includeDismissed: true }` makes the default listing request dismissed pipelines too, turning this test red — the negative case proving the flag, not the command, opts in.
- [x] `v2/src/commands/pipeline.test.ts` — `list --all marks dismissed rows in the human listing`; Mutation checkpoint: an in-body `// @mutate` directive replacing the conditional dismissal-column spread with an empty spread drops the marker from `--all` rows, turning this test red.
- [x] `v2/src/commands/pipeline.test.ts` — `list without --all renders no dismissal column`; Mutation checkpoint: an in-body `// @mutate` directive replacing the same conditional spread with an unconditional one appends the marker column to default rows, turning this test red — the negative case proving the column is suppressed without `--all`.
- [x] `v2/docs/write-behavior.md` — the `jarvis pipeline list` command-table row and the "List vs wait" prose record `--all` (request-level `includeDismissed: true` opt-in, composable with `--since`/`--state` and with `--json`), the `--all`-only trailing `dismissed`/`-` column, and that the default listing still requests the parameterless snapshot; the existing "no `--include-dismissed` flag yet" notes are replaced.
- [x] `v2/docs/v1-behaviors.md` — the `[v2 behavior change]` entries recording the default dismissed-exclusion are amended in place to name `jarvis pipeline list --all` as the CLI opt-in (`includeDismissed: true`), its `--all`-only dismissal column, and that `--json --all` passes the widened snapshot through unmodified.
- [x] `v2/docs/operator-runbook.md` — the `pipeline list` section records `--all` as the way to see dismissed pipelines, its composition with `--since`/`--state`/`--json` (including that `--all` does not lift the `--json`+filter incompatibility), the trailing dismissal column, and that a fully-dismissed default listing still prints `No pipelines.` with no hidden-count hint — pointing operators at `--all`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `pipeline list` row and "List vs wait" prose for `--all`, the dismissal column, and the unchanged default request.
- `v2/docs/v1-behaviors.md` — existing dismissed-exclusion entries amended to name the `--all` opt-in.
- `v2/docs/operator-runbook.md` — `pipeline list --all` in the listing section, the `--json`+filter incompatibility carve-out, and the fully-dismissed `No pipelines.` note.

## Implementer notes

- Suggested shape, keeping both guards quotable by one single-line `@mutate` directive each (escape inner quotes as `\"` inside a directive):

  ```ts
  const result: unknown = await request(client, "pipeline_list", parsed.all ? { includeDismissed: true } : undefined);
  ```

  ```ts
  ...(showDismissal ? [typeof pipeline.dismissedAt === "number" ? "dismissed" : "-"] : []),
  ```

  The first is the keystone anchor (replaced by `undefined`) and the default-request guard anchor (replaced by `{ includeDismissed: true }`); the second is the marker anchor (replaced by `...[],` and by the unconditional `...[typeof pipeline.dismissedAt === \"number\" ? \"dismissed\" : \"-\"],`). Each occurs exactly once in `pipeline.ts`.
- `renderPipelineListRows` takes the `--all` boolean as a third parameter; `selectPipelines` is unchanged — the daemon decides inclusion, the local filters decide selection.
- The marker predicate keys off `typeof dismissedAt === "number"`, not `dismissedAt === null`: a fixture that omits the field entirely still renders `-`, matching a genuinely non-dismissed pipeline, instead of misrendering as dismissed. The existing test snapshot fixtures (`SAMPLE_PIPELINE_SNAPSHOT` and friends) are plain object literals cast at the `selectPipelines` call site — any fixture exercised under `--all`, new or reused, needs `dismissedAt` set to a number only if it should render `dismissed`; the marker test needs one fixture with a present numeric `dismissedAt` and one with `dismissedAt: null` to prove both branches.
- `PipelineSnapshot.dismissedAt` is already `number | null` and always present on the wire (`v2/src/daemon/pipeline-observation.ts`); no client-side feature detection is needed.

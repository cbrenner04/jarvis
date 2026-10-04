# `pipeline dismiss` / `undismiss` subcommands

## Problem

`runPipelineCommand` (`v2/src/commands/pipeline.ts`) dispatches `start|list|wait|approve|reject|resume|recover` and nothing else; `pipeline dismiss` prints `PIPELINE_USAGE` and exits `1`. The `pipeline_dismiss` / `pipeline_undismiss` RPCs landed (`v2/src/daemon/daemon.ts`, `handlePipelineDismissalHandler`) with no caller, so the only operator lever over a dead pipeline is `reject`, which settles lifecycle state and still lists the pipeline.

## Decision ledger

- Dismissal gets its own `runPipelineDismissalCommand`, not a fourth `runPipelineMutationCommand` method — the dismissal `applied` result carries `state`, which `parsePipelineMutationOutcome` drops; rules out widening the shared parser and its `"applied" | "resumed"` success-kind union for a third result shape.
- `runPipelineDismissalCommand` takes `mode: "dismiss" | "undismiss"` as a parameter and derives the RPC method internally on one line (`const method = mode === "dismiss" ? "pipeline_dismiss" : "pipeline_undismiss"`), unlike `runPipelineMutationCommand`'s dispatch-site method argument — rules out threading the method in from the two dispatch branches instead, which would leave no single line selecting it for the keystone mutation to anchor on.
- Both subcommands print a one-line stdout confirmation naming the pipeline, unlike silent `approve`/`reject`/`resume` — rules out silence on a command whose only visible effect is a row disappearing from a later listing.
- The live warning fires whenever the returned `state` is non-terminal (`pending`, `running`, `awaiting-approval`), not only literal `running`, and names the state without asserting the pipeline is executing (e.g. "is `pending`", not "keeps running") — rules out silently hiding an abandoned-but-live approval gate, the most common dismissal target, and rules out wording that is false for a `pending` or `awaiting-approval` dismissal.
- The wire `state` on an `applied` outcome is narrowed to `PipelineDerivedState` through the same `string → PipelineDerivedState` set `pipeline list --state` already uses (`PIPELINE_LIST_STATE_VALUES` / `parsePipelineListStateValue`, `pipeline.ts`) before `isPipelineTerminal` reads it; a `state` outside that set is not a parsable `applied` shape and takes the `invalid daemon response` path — rules out accepting `state` as an opaque non-empty string reaching `isPipelineTerminal` unchecked, and rules out a second terminal-state list.
- Warning goes to stderr, confirmation to stdout — rules out one combined stdout block, which would put the warning inside a scripted caller's captured output.
- `undismiss` never warns; restoring a pipeline to the listing hides nothing.
- Refusals print the daemon `reason` verbatim on stderr, exit `1`, and print no confirmation — matching `approve`/`reject`; rules out re-wording `pipeline_not_found` in the CLI.
- Both subcommands connect via `withRunClient`, like `approve`/`reject`/`resume` — dismissal admits no execution; rules out the `connectWithAutoStart` path, which would boot a daemon just to hide a row.
- CLI tests pin the issued request, confirmation, warning, and exit code against a stubbed client; the intent's dismiss-then-list-omits/`--all`-shows and undismiss-restores-default-listing round trips stay pinned daemon-side in `v2/src/daemon/daemon-pipeline-dismiss.test.ts` (landed: `dismissed pipelines drop out of the default pipeline_list`, `pipeline_undismiss returns applied with state and restores the default listing`) — rules out re-asserting daemon-side filtering through canned CLI stub frames, which would prove only that the stub was written to agree.

## Task checklist

- Add `PIPELINE_DISMISS_USAGE` / `PIPELINE_UNDISMISS_USAGE` to `v2/src/cli/usage.ts` and extend `PIPELINE_USAGE`'s subcommand list.
- Add `dismiss` and `undismiss` nodes to the `pipeline` entry in `v2/src/cli/command-tree.ts`.
- Add `parsePipelineDismissalArgs`, `parsePipelineDismissalOutcome`, and `runPipelineDismissalCommand` to `v2/src/commands/pipeline.ts`, plus the two dispatch branches in `runPipelineCommand`.
- Add a `describe("pipeline dismiss")` block to `v2/src/commands/pipeline.test.ts` with the tests below and their in-body `// @mutate` directives, and extend the existing `help pipeline exposes the full family with list and wait semantics` test with the two new summaries.
- Update `v2/docs/operator-runbook.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A CLI test drives `pipeline dismiss <id>` against a stub returning `{ kind: "applied", pipelineId, state: "failed" }` and asserts one `pipeline_dismiss` frame carrying `{ pipelineId }`, exit `0`, empty stderr, and a one-line stdout confirmation naming the pipeline; it fails against the pre-fix CLI, which prints `PIPELINE_USAGE` on stderr and exits `1` for the unrecognized subcommand.
- [x] A CLI test drives `pipeline undismiss <id>` and asserts one `pipeline_undismiss` frame carrying `{ pipelineId }`, exit `0`, and a one-line stdout confirmation naming the pipeline.
- [x] A CLI test drives `pipeline dismiss <id>` against a stub returning `state: "running"` and asserts exit `0`, the stdout confirmation, and a stderr warning naming both the pipeline and the live `running` state, without asserting the pipeline is executing.
- [x] A CLI test drives `pipeline dismiss <id>` against a stub returning `state: "awaiting-approval"` and asserts the same stderr warning naming that state — the warning is not literal-`running`-only.
- [x] A CLI test drives `pipeline dismiss <id>` against a stub returning a terminal `state` and asserts stderr is empty — the warning is suppressed for a pipeline that is not live.
- [x] A CLI test drives both subcommands against a stub returning `{ kind: "refused", pipelineId, reason: "pipeline_not_found" }` and asserts exit `1`, `pipeline_not_found` verbatim on stderr, and empty stdout on each.
- [x] A CLI test asserts a missing, whitespace-only, or extra positional on either subcommand prints that subcommand's usage on stderr and exits `1` without contacting the daemon.
- [x] A CLI test asserts a result envelope that is neither a parsable `applied` nor `refused` shape — including an `applied` shape whose `state` is not a recognized `PipelineDerivedState` value — prints `invalid daemon response` on stderr and exits `1`.
- [x] `help pipeline` lists `dismiss` and `undismiss` with their summaries, and `help pipeline dismiss` / `help pipeline undismiss` print their own usage lines; the tree-walked dispatch coverage in `v2/src/cli.test.ts` reaches both new paths without either falling through to `PIPELINE_USAGE`.
- [x] `v2/src/commands/pipeline.test.ts` — `dismiss issues pipeline_dismiss and confirms the pipeline`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the request-method selector to always send `pipeline_undismiss` (baseline: no CLI path records a dismissal) turns this test red while the undismiss test stays green.
- [x] `v2/src/commands/pipeline.test.ts` — `dismiss and undismiss refuse an unknown pipeline id`; Mutation checkpoint: an in-body `// @mutate` directive neutering the `if (outcome.kind === "refused") {` branch to `if (false) {` makes a refusal print the success confirmation on stdout and exit `0`, turning this test red.
- [x] `v2/src/commands/pipeline.test.ts` — `dismissing a live pipeline warns naming its state`; Mutation checkpoint: an in-body `// @mutate` directive neutering the live-state warning guard to `if (false) {` drops the warning, turning this test red.
- [x] `v2/src/commands/pipeline.test.ts` — `dismissing a terminal pipeline prints no warning`; Mutation checkpoint: an in-body `// @mutate` directive dropping the `!isPipelineTerminal(outcome.state)` term from the same warning guard makes a terminal dismissal emit the live warning, turning this test red — the negative case proving the guard suppresses the warning rather than the warning never firing.
- [x] `v2/src/commands/pipeline.test.ts` — `dismiss and undismiss reject bad arity before contacting the daemon`; Mutation checkpoint: an in-body `// @mutate` directive neutering the argument-count check in `parsePipelineDismissalArgs` to `if (false)` makes an extra positional connect and issue an RPC instead of printing usage, turning this test red.
- [x] `v2/docs/operator-runbook.md` — a pipeline dismissal section records `jarvis pipeline dismiss <pipeline-id>` / `jarvis pipeline undismiss <pipeline-id>`, that dismissal hides a pipeline from listings without deleting durable rows (`pipeline resume`/`recover` and restart recovery still reach it), that dismissing a live pipeline succeeds with a stderr warning and does not stop it, that refusals print the daemon `reason` and exit non-zero, that a dismissed pipeline also disappears from the TUI with no TUI-side way back yet (points at the separate TUI-filtering intent), and cross-links the `pipeline-list-display-retention` seed as the separate unbounded-growth concern; the existing note that dismissal is "tracked by the `dismiss-pipeline-*` ready intents" is replaced, since this subspec ships it.
- [x] `v2/docs/write-behavior.md` — the pipeline command table gains `jarvis pipeline dismiss <pipeline-id>` and `jarvis pipeline undismiss <pipeline-id>` rows (positional rules, issued RPC and params, stdout confirmation, stderr live-state warning, refusal and malformed-envelope exit semantics), notes the confirmation reports post-dismissal state and does not distinguish a first dismissal from a repeat one, and `PIPELINE_USAGE`'s documented subcommand list is reconciled.
- [x] `v2/docs/v1-behaviors.md` — a `[v2 additive]` entry records the two subcommands, their confirmation/warning output, and their refusal exits; v1 has no equivalent.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — dismissal section: grammar, hides-without-deleting, live-pipeline warning, refusal exits, TUI blast radius (disappears there too, no way back yet), replaces the stale "tracked by ready intents" note, cross-link to the `pipeline-list-display-retention` seed.
- `v2/docs/write-behavior.md` — `pipeline dismiss` / `pipeline undismiss` command-table rows, the reconciled `PIPELINE_USAGE` subcommand list, and that the confirmation reports post-state without distinguishing a repeat dismissal from the first.
- `v2/docs/v1-behaviors.md` — `[v2 additive]` entry for the two subcommands.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive (escape inner quotes as `\"` inside a directive, as in `v2/src/execution/publication-landing.test.ts`):

  ```ts
  function parsePipelineDismissalArgs(argv: readonly string[]): { ok: true; pipelineId: string } | { ok: false } {
    if (argv.length !== 1) return { ok: false };
    const pipelineId = argv[0];
    if (pipelineId === undefined || pipelineId.trim().length === 0) return { ok: false };
    return { ok: true, pipelineId };
  }

  async function runPipelineDismissalCommand(
    mode: "dismiss" | "undismiss",
    pipelineId: string,
    io: Io,
    deps: CliDeps,
  ): Promise<number> {
    return withRunClient(io, deps, async (client) => {
      const method = mode === "dismiss" ? "pipeline_dismiss" : "pipeline_undismiss";
      const result = await requestPipelineRpc(client, method, { pipelineId }, io);
      if (!result.ok) return 1;
      const outcome = parsePipelineDismissalOutcome(result.response);
      if (outcome === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      if (outcome.kind === "refused") {
        io.stderr(`${outcome.reason}\n`);
        return 1;
      }
      if (mode === "dismiss" && !isPipelineTerminal(outcome.state)) {
        io.stderr(`pipeline dismiss: ${outcome.pipelineId} is ${outcome.state} and now hidden from listings\n`);
      }
      io.stdout(`pipeline ${mode}: ${outcome.pipelineId}\n`);
      return 0;
    });
  }
  ```

- The keystone directive quotes the `const method = ...` selector line and replaces the whole conditional with `\"pipeline_undismiss\"`; that line is the only occurrence of either method name in `pipeline.ts`. This line exists only because `runPipelineDismissalCommand` takes `mode` as a parameter (ledger decision above) — do not move the method selection to the two dispatch branches, which would leave nothing for the keystone directive to anchor on.
- `parsePipelineDismissalOutcome` must require `pipelineId` on both shapes, a `state` on `applied` narrowed through `parsePipelineListStateValue` (the existing `string → PipelineDerivedState` narrower `pipeline list --state` already uses) to a recognized `PipelineDerivedState`, and a string `reason` on `refused`; anything else — including an `applied` shape whose `state` isn't in `PIPELINE_LIST_STATE_VALUES` — returns `undefined` and takes the `invalid daemon response` path, matching `parsePipelineRecoverOutcome`.
- `requestPipelineRpc` already prints connection/RPC errors and returns `{ ok: false }` — reuse it rather than a second try/catch.
- `pipeline.ts` currently type-imports `PipelineDerivedState` from `../daemon/pipeline-execution.ts`; add the runtime `isPipelineTerminal` import from the same module (CLI modules already import daemon runtime helpers — see `v2/src/commands/run.ts`).
- The `v2/src/cli.test.ts` dispatch-coverage test walks `commandTree` and drives each path bare; bare `pipeline dismiss` prints `PIPELINE_DISMISS_USAGE`, which is not `PIPELINE_USAGE`, so no `operands` entry is required — add one (`["pipe-1"]`) only if the assertion proves otherwise.

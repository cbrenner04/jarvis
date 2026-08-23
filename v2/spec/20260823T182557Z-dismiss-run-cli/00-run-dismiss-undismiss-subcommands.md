# `run dismiss` / `undismiss` subcommands

## Problem

`runRunCommand` (`v2/src/commands/run.ts`) dispatches `start|workflow|list|log|pause|resume|kill|wait` and nothing else; `jarvis run dismiss` prints `RUN_USAGE` and exits `1`. The `dismiss` / `undismiss` RPCs landed (`v2/src/daemon/daemon.ts`, `handleRunDismissalHandler`) with no caller, so a dead terminal ad-hoc or workflow-entry run can only leave `jarvis run list` by aging past the fifty-newest terminal retention window; the operator cannot shed a specific row.

## Decision ledger

- Dismissal gets its own `runRunDismissalCommand`, not a fourth `runActionCommand` verb — `pause`/`resume`/`kill` ignore the response payload and print `<verb>d <run-id>`, while dismissal must parse `{ kind, runId, status }` to decide the live warning; rules out widening `runActionCommand`'s subcommand union and its response-blind success path.
- `runRunDismissalCommand` takes `mode: "dismiss" | "undismiss"` and derives the RPC method internally on one line (`const method = mode === "dismiss" ? "dismiss" : "undismiss"`), keeping method selection at exactly one call site — rules out threading the method in from the two dispatch branches, which would scatter the choice across callers. The RPC method names equal the mode, so this line is an identity map; it exists for the single-site property, not as the keystone anchor (that targets the `request(...)` call itself — see Implementer notes).
- Confirmation follows the run family's existing verb form (`dismissed <run-id>` / `undismissed <run-id>`, like `killed <run-id>`), not `pipeline dismiss`'s `pipeline dismiss: <id>` form — the intent mirrors pipeline's argument and refusal conventions, not its output; rules out two confirmation grammars inside `jarvis run`.
- Both subcommands connect with `withRunClient` on the invoking digest's socket only, with no `resolveRunOwnerSocket` discovery fallback — same connection behavior as `kill`/`pause`/`resume`, not a promise to reach an arbitrary daemon. Every keyed daemon opens the same state store (`~/.jarvis/state/v2.sqlite`), so a `dismiss`/`undismiss` issued against the operator's own reachable daemon writes the same durable row regardless of which daemon started the run; rules out the cross-daemon list round trip `run log` / `run wait` pay for run-owner routing.
- `withRunClient` (read-only style), not the auto-start dispatch `run start` / `run resume` use — dismissal admits no execution; rules out booting a daemon just to hide a row.
- The wire `status` on an `applied` outcome is narrowed through the existing `isRunStatus` guard before the terminal check; a `status` outside `RUN_STATUSES` is not a parsable `applied` shape and takes the `invalid daemon response` path — rules out handing an opaque string to `isTerminalRunStatus`.
- The live warning fires on any non-terminal durable status — `in-progress`, `budget-soft-stopped`, `paused`, `queued`, the four `RUN_STATUSES` members outside `TERMINAL_RUN_STATUSES` — and names that status without asserting the run is executing — durable status is not liveness, and `list`'s `isLive` is not on the dismissal response; rules out an `in-progress`-only warning, and rules out wording ("still running") that is false for a `queued`, `paused`, or `budget-soft-stopped` row.
- Warning goes to stderr, confirmation to stdout — rules out one combined stdout block, which would put the warning inside a scripted caller's captured output.
- `undismiss` never warns; restoring a run to the listing hides nothing.
- Refusals print the daemon `reason` verbatim on stderr, exit `1`, and print no confirmation — rules out re-wording `run_not_found` in the CLI.
- CLI tests pin the issued request, confirmation, warning, and exit code against a stubbed client; the intent's dismiss-then-`list`-omits and undismiss-restores-default-`list` round trips stay pinned daemon-side in `v2/src/daemon/daemon-run-dismiss.test.ts` (landed: `dismissed runs drop out of the default list`, `undismiss returns applied with status and restores the default listing`) — rules out re-asserting daemon-side filtering through canned CLI stub frames, which would prove only that the stub was written to agree.

## Task checklist

- Add `RUN_DISMISS_USAGE` / `RUN_UNDISMISS_USAGE` to `v2/src/cli/usage.ts` and extend `RUN_USAGE`'s subcommand list.
- Add `dismiss` and `undismiss` nodes to the `run` entry in `v2/src/cli/command-tree.ts`.
- Add `parseRunDismissalArgs`, `parseRunDismissalOutcome`, and `runRunDismissalCommand` to `v2/src/commands/run.ts`, plus the dispatch branch in `runRunCommand`.
- Add a `describe("run dismiss")` block to `v2/src/commands/run.test.ts` with the tests below and their in-body `// @mutate` directives.
- Update `v2/docs/operator-runbook.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A CLI test drives `run dismiss <id>` against a stub returning `{ kind: "applied", runId, status: "completed" }` and asserts one `dismiss` frame carrying `{ runId }`, exit `0`, empty stderr, and a one-line stdout confirmation naming the run; it fails against the pre-fix CLI, which prints `RUN_USAGE` on stderr and exits `1` for the unrecognized subcommand.
- [ ] A CLI test drives `run undismiss <id>` and asserts one `undismiss` frame carrying `{ runId }`, exit `0`, and a one-line stdout confirmation naming the run.
- [ ] A CLI test drives `run dismiss <id>` against a stub returning `status: "in-progress"` and asserts exit `0`, the stdout confirmation, and a stderr warning naming both the run and its `in-progress` status, without asserting the run is executing.
- [ ] A CLI test drives `run dismiss <id>` against stubs returning `status: "paused"`, `status: "queued"`, and `status: "budget-soft-stopped"` and asserts the same stderr warning naming each status — the warning is not `in-progress`-only.
- [ ] A CLI test drives `run dismiss <id>` against a stub returning a terminal `status` and asserts stderr is empty — the warning is suppressed for a run that is not live.
- [ ] A CLI test drives `run undismiss <id>` against a stub returning a non-terminal `status` and asserts empty stderr — `undismiss` never warns.
- [ ] A CLI test drives both subcommands against a stub returning `{ kind: "refused", runId, reason: "run_not_found" }` and asserts exit `1`, `run_not_found` verbatim on stderr, and empty stdout on each.
- [ ] A CLI test asserts a missing, whitespace-only, or extra positional on either subcommand prints that subcommand's usage on stderr and exits `1` without contacting the daemon.
- [ ] A CLI test asserts a result envelope that is neither a parsable `applied` nor `refused` shape — including an `applied` shape whose `status` is not a recognized `RunStatus` — prints `invalid daemon response` on stderr and exits `1`.
- [ ] `help run` lists `dismiss` and `undismiss` with their summaries, and `help run dismiss` / `help run undismiss` print their own usage lines; the tree-walked dispatch coverage in `v2/src/cli.test.ts` reaches both new paths without either falling through to `RUN_USAGE`.
- [ ] `v2/src/commands/run.test.ts` — `dismiss issues the dismiss request and confirms the run`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the `request(client, method, { runId })` call to always send `"undismiss"` regardless of `method` (baseline: no CLI path records a dismissal) turns this test red while the undismiss test stays green.
- [ ] `v2/src/commands/run.test.ts` — `dismiss and undismiss refuse an unknown run id`; Mutation checkpoint: an in-body `// @mutate` directive neutering the refusal branch to `if (false) {` makes a refusal print the success confirmation on stdout and exit `0`, turning this test red.
- [ ] `v2/src/commands/run.test.ts` — `dismissing a live run warns naming its status`; Mutation checkpoint: an in-body `// @mutate` directive neutering the live-status warning guard to `if (false) {` drops the warning, turning this test red.
- [ ] `v2/src/commands/run.test.ts` — `dismissing a terminal run prints no warning`; Mutation checkpoint: an in-body `// @mutate` directive dropping the terminal-status term from the same warning guard makes a terminal dismissal emit the live warning, turning this test red — the negative case proving the guard suppresses the warning rather than the warning never firing.
- [ ] `v2/src/commands/run.test.ts` — `dismiss and undismiss reject bad arity before contacting the daemon`; Mutation checkpoint: an in-body `// @mutate` directive neutering the argument-count check in `parseRunDismissalArgs` to `if (false)` makes an extra positional connect and issue an RPC instead of printing usage, turning this test red.
- [ ] `v2/docs/operator-runbook.md` — a run dismissal section records `jarvis run dismiss <run-id>` / `jarvis run undismiss <run-id>`, that dismissal requires the operator's own daemon reachable (no cross-daemon discovery) and hides a run from listings without deleting the durable row (`wait`, `kill`, `pause`, `resume`, `run log`, `jarvis cleanup`'s daemon-list safety reads, and reconciliation still reach it — a dismissed but live run stays invisible in `run list` while still blocking worktree retirement), that dismissing a live run succeeds with a stderr warning and does not stop it, that dismissing a workflow entry run does not dismiss its step rows (each carries its own dismissal, so shedding a whole invocation means dismissing each row, and dismissed siblings are still folded back in for invocation indexing), that refusals print the daemon `reason` and exit non-zero, that a dismissed run stops being returned by the daemon's default listing but the TUI's last-good snapshot merge can keep painting it until the `dismiss-run-tui-display` ready intent lands, and cross-links the pipeline dismissal section and the `pipeline-list-display-retention` seed as the separate unbounded-growth concern.
- [ ] `v2/docs/write-behavior.md` — the Run control CLI table gains `jarvis run dismiss <run-id>` and `jarvis run undismiss <run-id>` rows (positional rules, issued RPC and params, stdout confirmation, stderr live-status warning, refusal and malformed-envelope exit semantics), notes the confirmation does not distinguish a first dismissal from a repeat one, and `RUN_USAGE`'s documented subcommand list is reconciled.
- [ ] `v2/docs/v1-behaviors.md` — a `[v2 additive]` entry records the two subcommands, their confirmation and live-status warning output, and their refusal exits; v1 has no equivalent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — run dismissal section: grammar, own-daemon-reachable requirement, hides-without-deleting (incl. `jarvis cleanup`'s safety reads and workflow step-run scoping), live-run warning, refusal exits, TUI blast radius (daemon stops returning it, but last-good snapshot merge can keep it painted until `dismiss-run-tui-display` lands), cross-links to pipeline dismissal and the `pipeline-list-display-retention` seed.
- `v2/docs/write-behavior.md` — `jarvis run dismiss` / `jarvis run undismiss` command-table rows and the reconciled `RUN_USAGE` subcommand list.
- `v2/docs/v1-behaviors.md` — `[v2 additive]` entry for the two subcommands.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive (escape inner quotes as `\"` inside a directive, as in `v2/src/commands/pipeline.test.ts`):

  ```ts
  function parseRunDismissalArgs(argv: readonly string[]): { ok: true; runId: string } | { ok: false } {
    if (argv.length !== 1) return { ok: false };
    const runId = argv[0];
    if (runId === undefined || runId.trim().length === 0) return { ok: false };
    return { ok: true, runId };
  }

  async function runRunDismissalCommand(
    mode: "dismiss" | "undismiss",
    runId: string,
    io: Io,
    deps: CliDeps,
  ): Promise<number> {
    return withRunClient(io, deps, async (client) => {
      const method = mode === "dismiss" ? "dismiss" : "undismiss";
      let response: unknown;
      try {
        response = await request(client, method, { runId });
      } catch (error) {
        if (error instanceof RpcError) {
          io.stderr(formatRpcError(error));
          return 1;
        }
        throw error;
      }
      const outcome = parseRunDismissalOutcome(response);
      if (outcome === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      if (outcome.kind === "refused") {
        io.stderr(`${outcome.reason}\n`);
        return 1;
      }
      if (mode === "dismiss" && !isTerminalRunStatus(outcome.status)) {
        io.stderr(`run dismiss: ${outcome.runId} is ${outcome.status} and now hidden from listings\n`);
      }
      io.stdout(`${mode === "dismiss" ? "dismissed" : "undismissed"} ${outcome.runId}\n`);
      return 0;
    });
  }
  ```

- The keystone directive quotes the `response = await request(client, method, { runId });` call and replaces `method` with `\"undismiss\"`, forcing every dismissal request onto the undismiss RPC regardless of `mode`. Keep `method` selection at this one call site; the two `mode === "dismiss"` comparisons in the warning and confirmation lines are separate mode checks, not method selection, and are fine to keep as literals.
- `parseRunDismissalOutcome` must require a non-empty `runId` on both shapes, a `status` on `applied` narrowed through the already-imported `isRunStatus`, and a string `reason` on `refused`; anything else returns `undefined` and takes the `invalid daemon response` path.
- `run.ts` already imports `isRunStatus` and `TERMINAL_RUN_STATUSES` from `../persistence/state-store.ts`; add the runtime `isTerminalRunStatus` import from the same module (or read `TERMINAL_RUN_STATUSES` directly) rather than writing a second terminal-status list.
- Daemon response shapes are pinned in `v2/src/daemon/daemon-run-dismiss.test.ts`: `{ kind: "applied", runId, status }` and `{ kind: "refused", runId, reason: "run_not_found" }`. A missing/blank `runId` param is refused RPC-side as `invalid_params`, but the CLI arity check makes that unreachable from this path.
- Dispatch the two subcommands in `runRunCommand` before the `isRunAction` branch; each parses its own argv slice, so a bare `jarvis run dismiss` prints `RUN_DISMISS_USAGE` (not `RUN_USAGE`) without connecting.
- The `v2/src/cli.test.ts` dispatch-coverage test walks `commandTree` and drives each path bare; add an `operands` entry only if the assertion proves one is required.
- If the new dispatch branch trips `runRunCommand`'s cognitive-complexity cap, split it out the way the pipeline dispatcher was split for the same reason; `runRunCommand`'s existing inline `log`-parsing shape is the baseline to match either way.

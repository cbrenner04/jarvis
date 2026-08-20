# Parse and forward `--force` on `run kill`

## Problem

`runActionCommand` (`v2/src/commands/run.ts`) takes `argv` raw: it rejects anything but exactly one positional and always issues `request(client, subcommand, { runId })`. There is no flag parsing on `pause`/`resume`/`kill` at all, so the force param the `kill` handler already accepts (`v2/src/daemon/daemon.ts`, `forceSettleAdmitsRun`) is unreachable from a terminal. A stale `paused` row whose loop is gone — the row `resume` refuses with `unsupported_resume_context` — is neither resumable nor killable by an operator, and because `paused` is not terminal it never ages out of `retainListedRuns`' fifty-newest-terminal window; it paints in `run list` and the tui work tree forever.

Today's raw-`argv` handling also mis-parses flag-shaped input: `jarvis run pause --force` passes `--force` through as the run id. Adding the flag to `kill` without parsing the other two would leave that intact and silently accept `--force` as a run id on `pause`/`resume`.

`run kill` carries no `flags` and no `usage` on its `commandTree` node (`v2/src/cli/command-tree.ts`), and `["run", "kill"]` is absent from `PARITY_PATHS` (`v2/src/cli/help-flags-parity.ts`), so nothing would hold help output and the parser in sync for the new flag.

## Decision ledger

- `--force` is parsed on `kill` only; `pause` and `resume` accept no flags — rules out a shared action flag implying a nonexistent forced pause/resume.
- All three actions route through one `parseArgs({ strict: true, allowPositionals: true })` call whose `options` is `RUN_KILL_PARSE_ARG_OPTIONS` for `kill` and `{}` otherwise — rules out parsing only for `kill`, which leaves `jarvis run pause --force` sending `--force` as the run id (today's behavior) instead of erroring.
- `kill` gets its own `RUN_KILL_USAGE` (`usage: jarvis run kill <run-id> [--force]`), printed on its usage errors and registered as the tree node's `usage` — rules out reusing `RUN_USAGE`, which cannot advertise `--force` without implying `pause`/`resume` take it. `pause`/`resume` usage errors keep printing `RUN_USAGE` unchanged.
- The `force` key is present on the request params only when the flag is set; a plain kill sends `{ runId }` with no `force` key — rules out always sending `force: <boolean>`, which is daemon-equivalent but changes every existing kill frame and makes the unforced case unfalsifiable on the wire.
- The CLI never inspects run liveness before sending: `--force` is forwarded whenever set, including on an active run, and the daemon picks abort vs. force-settlement — rules out a client-side `list` precheck that would make the command depend on a second RPC and a liveness race.
- `kill` keeps `withRunClient` against `deps.socketPath`, with no `resolveRunOwnerSocket` call — rules out adding owner-socket resolution (which `pause`/`resume`/`kill` have never done); durable rows are shared across keyed daemons under one `JARVIS_HOME` and the handler's own owner guard already refuses a live foreign owner.
- Success output stays `killed <id>` on both paths, and a refused force attempt keeps the existing `formatRpcError` passthrough with exit 1 — rules out force-worded success text or swallowing `run_not_active` as success.
- `v2/src/tui/tui-daemon-client.ts` is untouched: the tui `k` binding keeps sending `kill` with `{ runId }` only.
- `run wait`'s pre-existing flag-shaped-argv mis-parsing (`v2/src/commands/run.ts:367`, a flag sent through as the run id into `resolveRunOwnerSocket`) is a declared non-goal, not an unaddressed inconsistency — fixing it means a third parse path on a read-only command whose failure mode is a harmless `unknown_run`.
- Inherited hazard, not introduced here: the daemon only takes the safe abort path when the active run's kind is `write-loop` or `workflow` (`activeRunAcceptsKill`, `v2/src/daemon/daemon.ts`); an active `finalization` or `recovery` kind falls through to the already-shipped `forceSettleAdmitsRun`, which stamps the row `killed` while that work keeps running. This spec makes that gap reachable from a terminal; it does not tighten `activeRunAcceptsKill`/`forceSettleAdmitsRun` — that daemon-side tightening is follow-up work outside this CLI-admission surface. The operator caveat lives in the runbook criterion below.
- `--force=false` is rejected, not honored as "don't force": `parseArgs` with a `type: "boolean"` option only recognizes bare `--force`, so `--force=false` throws under `strict: true` and prints usage like any other unrecognized shape.
- No `-f` short alias is offered; `RUN_KILL_PARSE_ARG_OPTIONS` declares `--force` only.
- `daemon stop --force` (hand-parsed, help-invisible) is not the precedent followed here — `run kill --force` gets strict parsing, a dedicated usage string, and parity-guard registration instead, matching `run log --follow`'s shape.

## Task checklist

- Add `RUN_KILL_USAGE = "usage: jarvis run kill <run-id> [--force]\n"` to `v2/src/cli/usage.ts`.
- Add `RUN_KILL_PARSE_ARG_OPTIONS = { force: { type: "boolean" } }` and a one-entry `RUN_KILL_HELP_FLAGS` (non-empty description) to `v2/src/cli/command-help-flags.ts`.
- Give the `run` → `kill` node in `v2/src/cli/command-tree.ts` `usage: RUN_KILL_USAGE` and `flags: RUN_KILL_HELP_FLAGS`.
- Add `["run", "kill"]` to `PARITY_PATHS` and a `case "run kill":` to `parserAcceptedLongFlags` in `v2/src/cli/help-flags-parity.ts`.
- In `runActionCommand` (`v2/src/commands/run.ts`), parse `argv` once with `parseArgs` before the positional check, selecting options by subcommand on a single quotable line; print the subcommand's usage on a parse throw and on a positional-count mismatch; forward `values.force === true ? { runId, force: true } : { runId }` on the `kill` request.
- Add the CLI tests below to `v2/src/commands/run.test.ts` with in-body `// @mutate` directives on the real guards, and the parity test to `v2/src/cli/help-flags-parity.test.ts`.
- Add `["run kill", ["help", "run", "kill"], RUN_KILL_USAGE, RUN_KILL_HELP_FLAGS]` to the `command help lists registered flags` case table in `v2/src/cli.test.ts`.
- Update `v2/docs/operator-runbook.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/commands/run.test.ts` test `run kill --force forwards the force param` fails against the pre-fix code, then proves `jarvis run kill --force run-123` sends one `kill` request whose params are exactly `{ runId: "run-123", force: true }`, exits 0, and prints `killed run-123` on stdout with empty stderr.
- [ ] `v2/src/commands/run.test.ts` test `run kill without --force sends no force param` proves `jarvis run kill run-123` sends one `kill` request whose params are exactly `{ runId: "run-123" }` — no `force` key at all — and still prints `killed run-123`.
- [ ] `v2/src/commands/run.test.ts` test `pause and resume reject --force as a usage error` proves `jarvis run pause --force run-123`, `jarvis run resume --force run-123`, `jarvis run pause --force`, and `jarvis run resume --force` each exit 1 with `RUN_USAGE` on stderr, empty stdout, and no request sent; it fails against the pre-fix code, where the single-positional forms send `--force` through as the run id.
- [ ] `v2/src/commands/run.test.ts` test `run kill run-123 --force also sends force after the run id` proves flag-after-positional (mirroring the existing `run log --follow before the run id` ordering coverage) also sends `{ runId: "run-123", force: true }` and exits 0.
- [ ] `v2/src/commands/run.test.ts` test `run kill --force with no run id is a usage error` proves `jarvis run kill --force` alone exits 1, prints `RUN_KILL_USAGE` on stderr, empty stdout, and sends no request.
- [ ] `v2/src/commands/run.test.ts` test `run kill --force passes through run_not_active refusals` proves a refused forced kill still sent a `kill` request whose params were exactly `{ runId: "run-123", force: true }`, exits 1, and prints `run_not_active: Run run-123 is not currently active` on stderr with empty stdout — this is the pre-existing `run kill passes through unknown_run errors` passthrough path preserved under the new force param, not new-behavior evidence.
- [ ] `v2/src/cli/help-flags-parity.test.ts` test `run kill parser and help flags stay aligned` proves `parserAcceptedLongFlags(["run", "kill"])` is `["--force"]` and that it is fully covered by the registered `run kill` help flags; it fails against the pre-fix code, where that path has no registered parser surface.
- [ ] `jarvis help run kill` prints `usage: jarvis run kill <run-id> [--force]` followed by the registered `--force` help line, exits 0, and writes nothing to stderr, pinned by the `command help lists registered flags` case table in `v2/src/cli.test.ts`.
- [ ] `v2/src/commands/run.test.ts` — `run kill --force forwards the force param`; Keystone checkpoint: an in-body `// @mutate` directive reverting the `kill` request's params expression to the baseline `{ runId }` (dropping the `values.force === true ?` branch) turns this test red while the unforced kill test stays green.
- [ ] `v2/src/commands/run.test.ts` — `run kill without --force sends no force param`; Mutation checkpoint: an in-body `// @mutate` directive replacing the params expression's condition so `force: true` is always attached turns this test red, proving the suppressed `force` key is genuinely absent on a plain kill rather than coincidentally ignored.
- [ ] `v2/src/commands/run.test.ts` — `pause and resume reject --force as a usage error`; Mutation checkpoint: an in-body `// @mutate` directive widening the parse-options selection so `pause`/`resume` also receive `RUN_KILL_PARSE_ARG_OPTIONS` makes `--force` parse on those subcommands, turning this test red.
- [ ] `v2/src/cli/help-flags-parity.test.ts` — `run kill parser and help flags stay aligned`; Mutation checkpoint: an in-body `// @mutate` directive renaming the registered `run kill` help flag's `name` away from `--force` in `v2/src/cli/command-help-flags.ts` opens a parity gap, turning this test red — proving the guard actually covers the `run kill` path rather than passing vacuously.
- [ ] Existing run-control coverage stays green and unchanged: the pre-existing `run pause`, `run resume`, `run kill`, and `run log` tests in `v2/src/commands/run.test.ts`; `v2/src/cli.test.ts` tests `help run pause prints ancestor usage (no subcommands)` and the `dispatch-coverage: every tree path is dispatchable` block; and the tui client's kill coverage under `v2/src/tui/`, whose expected kill frame params stay `{ runId: "run-123" }`.
- [ ] `v2/docs/write-behavior.md` — the run CLI table's `jarvis run kill` row records the optional `--force`, that it rides the kill request only when passed, that an active run still takes the ordinary abort path only when its active kind is `write-loop`/`workflow`, that output stays `killed <run-id>` with exit 0 on both paths, and that `pause`/`resume`/`kill` now strict-parse argv, so an unrecognized flag (including `--force` on `pause`/`resume`) is a usage error rather than being sent through as the run id.
- [ ] `v2/docs/operator-runbook.md` — a recovery entry for clearing a stale non-active run: reach for `jarvis run kill --force <run-id>` only after `resume` refuses (or the row has no resumable write context); do not force a row whose owning daemon is mid-`finalization` or mid-`recovery` — the force path only takes the safe abort branch for live `write-loop`/`workflow` kinds, and would stamp a mid-finalization/mid-recovery row `killed` while that work keeps running; it settles the durable row `killed` with a finish timestamp rather than deleting it; a force-settled workflow step stays listed until every non-terminal sibling in its `invocationId` is also settled, so clearing a stale workflow means forcing each non-terminal sibling, not just the one row; `kill` does not auto-start the daemon (unlike `resume`), so a stale row plus a stopped daemon yields a connection error, not a kill; after a daemon restart a stale row's owner is a dead prior incarnation, which run reconciliation settles on its own without a forced kill; and it clears the run row only — pipeline/stage display rows are a separate concern tracked by the `dismiss-pipeline-*` ready intents.
- [ ] `v2/docs/v1-behaviors.md` — the existing force-kill bullet's "No `jarvis run kill --force` CLI flag or TUI affordance exists yet" claim is corrected: the v2-only CLI flag now exists, is parsed on `kill` only, rides the kill request only when passed, and no TUI affordance exists; also records that `pause`/`resume`/`kill` now strict-parse argv, so a flag-shaped argument on `pause`/`resume` (e.g. `jarvis run pause --force <id>`, previously sent through as the run id and surfaced as `unknown_run`) now exits 1 with a usage error instead.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — run CLI table `jarvis run kill` row: optional `--force`, conditional forwarding, active-run abort precedence scoped to `write-loop`/`workflow` kinds, unchanged `killed <run-id>` output and exit code, and the strict-parsing flip on `pause`/`resume`/`kill`.
- `v2/docs/operator-runbook.md` — recovery entry for clearing a stale non-active/unresumable run with `run kill --force`: when to reach for it versus `resume`; the mid-finalization/mid-recovery force-a-live-run caveat; that the row is settled (not deleted) and then ages out under normal terminal retention, gated by invocation-sibling quiescence for workflow rows; that `kill` does not auto-start the daemon; the reconciliation-clears-dead-owner alternative after a daemon restart; and that pipeline/stage display clearing is out of its scope. Cross-link `daemon-host.md`'s `kill` RPC row rather than restating the daemon's admissibility guards.
- `v2/docs/v1-behaviors.md` — correct the daemon force-kill bullet's "no CLI flag yet" claim, record the v2-only `run kill --force` flag, and record the `pause`/`resume`/`kill` strict-argv-parsing behavior change.

## Implementer notes

- Suggested `runActionCommand` shape — keep the options selection and the params expression each on their own line so both stay independently quotable by one `@mutate` directive:

  ```ts
  const usage = subcommand === "kill" ? RUN_KILL_USAGE : RUN_USAGE;
  let values: { force?: boolean };
  let positionals: string[];
  try {
    const options = subcommand === "kill" ? RUN_KILL_PARSE_ARG_OPTIONS : {};
    const parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    io.stderr(usage);
    return 1;
  }
  const runId = positionals[0];
  if (positionals.length !== 1 || runId === undefined) {
    io.stderr(usage);
    return 1;
  }
  ```

  and at the `kill`/`pause` send site:

  ```ts
  const params = values.force === true ? { runId, force: true } : { runId };
  await request(client, subcommand, params);
  ```

- `parseArgs` with `options: {}` and `strict: true` throws on any `--flag`, which is what turns `run pause --force` into a usage error; that is the only behavior change to `pause`/`resume`, and it is the point of the third acceptance criterion.
- `makeIpcClient(frames, { sent })` (`v2/src/testing/cli-test-helpers.ts`) captures every sent frame; assert on the `method: "kill"` frame's `params` with `toEqual` so an extra `force` key fails, not `toMatchObject`.
- Existing tests in this area use `withFixedUuid(requestId, ...)` to pin the request id; follow that pattern so the fake's response frame matches.
- The `run kill` command-tree node currently has no `usage`, so `jarvis help run kill` falls back to the ancestor `RUN_USAGE`; adding `usage: RUN_KILL_USAGE` is what makes it render its own line. Do not touch `RUN_USAGE` itself — `v2/src/cli.test.ts` pins it verbatim for `help run pause`.
- `parserAcceptedLongFlags` throws for any `PARITY_PATHS` entry with no `case`, so the two edits in `help-flags-parity.ts` must land together.
- `v2/src/cli.test.ts`'s `command help lists registered flags` block uses a template-literal test title; do not hang an `@mutate` directive off it — the mutation checkpoints belong on the literal-titled tests named in the acceptance criteria.
- Add no test-only inversion hooks; every directive must mutate the real CLI parsing, params, or help-registration code.
- The flag-after-positional test mirrors `run log --follow before the run id also sends follow: true` (`v2/src/commands/run.test.ts`), just with the ordering flipped — `parseArgs({ allowPositionals: true })` accepts flags on either side of the positional.
- Do not touch `activeRunAcceptsKill`/`forceSettleAdmitsRun` (`v2/src/daemon/daemon.ts`) — the finalization/recovery force hazard is inherited from the already-shipped daemon path and is explicitly out of scope; the runbook doc criterion is where the operator caveat lives.

# Recover a blocked branch stage from the CLI

## Problem

`runPipelineCommand` (`v2/src/commands/pipeline.ts`) dispatches `start|list|wait|approve|reject|resume`; `jarvis pipeline recover ...` falls through to `PIPELINE_USAGE` and exits `1` without contacting the daemon. The daemon's `pipeline_recover` RPC already admits branch-scoped blocked plan-stage recovery (`v2/docs/daemon-host.md` § Branch-scoped blocked plan-stage recovery), so the documented operator loop — correct the blocked branch worktree's `.jarvis-plan-stage/`, then ask the daemon to revalidate that staged tree and continue only that branch — is reachable only over raw IPC. The closest CLI verb, `pipeline resume`, is the wrong request: it reopens the failed row and re-dispatches the stage through its ordinary write step, redrafting instead of revalidating the operator's corrections.

## Decision ledger

- `recover` is its own `pipeline` subcommand taking `<pipeline-id> <branch-key>` as two positionals; rules out overloading `pipeline resume` with a flag, which would make one replay verb mean two different daemon requests, and rules out a `--branch` flag, since `approve`/`reject` already take the branch key positionally.
- Both positionals are required and non-blank after trim, checked before daemon connect; rules out spending a round trip on the daemon's `invalid_params`, and rules out defaulting the branch to `default` — a mistargeted recovery re-invokes review agents against the wrong branch.
- Both positionals forward untrimmed once non-blank; rules out CLI-side normalization, since the daemon matches durable `branch_key` values exactly.
- Success prints the daemon's `admitted` result as one minified JSON line and exits `0`; rules out `approve`/`reject`/`resume`'s silent-on-success shape, which would leave the operator no handle on a detached attempt whose response never carries its outcome (`stageId`/`entryRunId` are how the operator reaches `jarvis run log` and the settled stage row).
- A `resolution_refused` result prints `<reason>: <message>` on stderr; rules out printing the bare `reason` token, which drops the only text naming which row refused and why.
- `stage_claimed` prints a named refusal line and exits `1`; rules out treating any non-`admitted` kind as success.
- An unrecognized result kind prints `invalid daemon response` and exits `1`, matching `pipeline wait`/`list`/`approve`; rules out defaulting an unknown envelope to admitted.
- Scope is the CLI admission surface only: no daemon change, and no TUI recovery affordance; rules out absorbing the TUI attention-row surface into this PR.

## Task checklist

- Add `PIPELINE_RECOVER_USAGE` to `v2/src/cli/usage.ts` and name `recover` in `PIPELINE_USAGE`.
- Register the `recover` subcommand (summary + usage) in `v2/src/cli/command-tree.ts`.
- Add a recover argument parser, a recover result parser, and a `recover` branch in `runPipelineCommand` (`v2/src/commands/pipeline.ts`) issuing one `pipeline_recover` RPC.
- Extend `v2/src/commands/pipeline.test.ts` with admission, refusal, arity, and help coverage, with in-body `// @mutate` directives on real production lines.
- Update `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline.test.ts` test `pipeline recover admits a branch-scoped recovery request` fails against the pre-fix code, then proves `jarvis pipeline recover <pipeline-id> <branch-key>` sends exactly one `pipeline_recover` frame whose params are `{ pipelineId, branchKey }` with both values untrimmed and unnormalized, prints the daemon's `admitted` result as one minified JSON line on stdout, and exits `0`.
- [ ] `pipeline.test.ts` test `pipeline recover reports daemon refusals without admitting` proves a `resolution_refused` result prints `<reason>: <message>` on stderr, a `stage_claimed` result prints a named refusal line identifying the claimed stage, and an unrecognized result kind prints `invalid daemon response` — each writing no stdout and exiting `1`.
- [ ] `pipeline.test.ts` test `pipeline recover rejects malformed arity before daemon connect` proves one positional, three positionals, and a whitespace-only branch key each print `PIPELINE_RECOVER_USAGE`, exit `1`, and open no IPC client.
- [ ] `pipeline.test.ts` test `help pipeline recover matches recover usage` proves `jarvis help pipeline recover` renders `PIPELINE_RECOVER_USAGE`, and `jarvis help pipeline` renders the `recover` summary line plus a `PIPELINE_USAGE` string naming `recover`.
- [ ] `pipeline.test.ts` — `pipeline recover admits a branch-scoped recovery request`; Keystone checkpoint: an in-body `// @mutate` directive replacing the `recover` dispatch branch's call to the recover command with the baseline usage path (`io.stderr(PIPELINE_USAGE); return 1;`) makes the CLI print usage and contact no daemon, turning this test red on the sent-frame and stdout assertions.
- [ ] `pipeline.test.ts` — `pipeline recover rejects malformed arity before daemon connect`; Mutation checkpoint: an in-body `// @mutate` directive widening the recover arity guard to admit a third positional makes the extra-argument case connect to the daemon instead of printing usage, turning this test red.
- [ ] `pipeline.test.ts` — `pipeline recover rejects malformed arity before daemon connect`; Mutation checkpoint: a second in-body `// @mutate` directive neutering the blank-positional guard so only zero-length values are rejected makes the whitespace-only branch key send a `pipeline_recover` frame instead of printing usage, turning this test red.
- [ ] `pipeline.test.ts` — `pipeline recover reports daemon refusals without admitting`; Mutation checkpoint: an in-body `// @mutate` directive collapsing the recover exit-code expression to an unconditional `0` makes the `resolution_refused` and `stage_claimed` cases exit `0`, turning this test red.
- [ ] `pipeline.test.ts` — `pipeline recover reports daemon refusals without admitting`; Mutation checkpoint: a second in-body `// @mutate` directive neutering the unknown-result-kind guard in the recover result parser makes an unrecognized envelope suppress `invalid daemon response` and take the admitted path, turning this test red — the guard's negative case (no `invalid daemon response` on a well-formed refusal) stays proven by the same test's refusal assertions.
- [ ] Existing `pipeline.test.ts` coverage stays green: `pipeline resume exits 0 on resumed for %s` still asserts its own `pipeline_resume` frame, the approve/reject decision tests are unchanged, and `help pipeline exposes the full family with list and wait semantics` stays green against the updated `PIPELINE_USAGE` constant.
- [ ] `v2/docs/write-behavior.md` carries a `jarvis pipeline recover <pipeline-id> <branch-key>` command-table row (positional rules and pre-connect usage errors, admitted JSON stdout, exit codes, the single `pipeline_recover` RPC with `{ pipelineId, branchKey }`, and refusal rendering for `resolution_refused`/`stage_claimed`/malformed envelopes), plus a recover-vs-resume note stating exit `0` means admitted, not recovered, and that the settled outcome is observable only on the stage row.
- [ ] `v2/docs/operator-runbook.md` § Pipeline recover states the whole operator loop: read the blocked branch's stage row and `workflowInvocationId` from `jarvis pipeline list`, get that run's `worktreePath` from `jarvis run list`/`run wait`, correct `<worktreePath>/.jarvis-plan-stage/` and remove any operator-authored `## Blocker` (recovery always refuses `operator_blocker`), run `jarvis pipeline recover <pipeline-id> <branch-key>`, then read the settled `status`/`artifact`/`failureDetail` from `jarvis pipeline list` because the command returns at admission; it also distinguishes recovery from `pipeline resume` (which redrafts the stage) and from `pipeline approve`/`reject` (gate decisions), and states that sibling branches and their gates are untouched.
- [ ] `v2/docs/v1-behaviors.md` records the additive v2 CLI command for branch-scoped blocked-stage recovery and corrects the existing `pipeline_recover` bullet's claim that an operator-facing client is a deferred successor and the RPC is reachable only over IPC.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline recover` command-table row and the recover-vs-resume note (admission is not an outcome).
- `v2/docs/operator-runbook.md` — new § Pipeline recover: locating the blocked branch's worktree and its `.jarvis-plan-stage/`, the correction, the command, reading the settled row, and recovery vs resume vs approval decisions.
- `v2/docs/v1-behaviors.md` — additive CLI command for branch-scoped blocked-stage recovery; correct the deferred-client sentence on the existing `pipeline_recover` bullet.

## Implementer notes

- Daemon contract to code against: `v2/docs/daemon-host.md` § Branch-scoped blocked plan-stage recovery and § `pipeline_recover` RPC and detached admission. Result kinds are `{ kind: "admitted", pipelineId, branchKey, stageId, entryRunId }`, `{ kind: "resolution_refused", pipelineId, branchKey, reason, message }`, and `{ kind: "stage_claimed", pipelineId, branchKey, stageId }`; `invalid_params`, `daemon_superseded`, and `worktree_claimed` come back as RPC errors and render through the existing `formatRpcError` path.
- `runPipelineMutationCommand` cannot be reused as-is — it parses only `applied`/`resumed`/`refused`. Add a recover-specific result parser rather than widening the shared one.
- Keep the arity guard, the blank-positional guard, the exit-code expression, and the unknown-kind guard each on one physical line so every `@mutate` directive quotes unique single-line text. Suggested shapes: `if (argv.length !== 2) return { ok: false };`, `if (pipelineId.trim().length === 0 || branchKey.trim().length === 0) return { ok: false };`, `return outcome.kind === "admitted" ? 0 : 1;`, and a `Set`-membership kind check in the result parser.
- Reuse `makeIpcClient`, `ipcFramesWithMethod`, and `withFixedUuid` from the existing pipeline describe blocks; the usage-error cases follow the existing `resume usage error %p prints usage before daemon connect` pattern (a `connectIpcClient` that throws proves no daemon contact).
- `v2/spec/20260818T141301Z-expose-branch-scoped-pipeline-resume-cli` touches the same file's `resume` branch and `PIPELINE_RESUME_USAGE`. If it has landed first, rebase on it and leave its resume grammar alone; this subspec changes no resume behavior.
- Add no test-only inversion hooks; every directive must mutate a real CLI guard, dispatch line, or expression.

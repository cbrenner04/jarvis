# Forward branch scope in the pipeline resume CLI

## Problem

`runPipelineCommand`'s `resume` branch requires `argv.length !== 2` and always sends `{ pipelineId }`. The daemon's `pipeline_resume` now accepts an optional non-blank `branchKey` and forwards it to branch-local resume admission, but no CLI path can produce that param: `jarvis pipeline resume <pipeline-id> <branch-key>` prints usage and never contacts the daemon. On a fan-out pipeline whose siblings sit at `awaiting` gates, the only reachable CLI form derives `awaiting-approval`, exits `0`, and leaves the operator's failed branch unreopened.

## Decision ledger

- Branch scope is an optional second positional on `pipeline resume`; rules out a `--branch` flag and a separate subcommand, and matches `approve`/`reject`, which already take `<branch-key>` positionally.
- The CLI sends `{ pipelineId }` verbatim when no branch positional is supplied, adding `branchKey` only when it is; rules out always sending `branchKey` (as `undefined`, `""`, or `"default"`), which would change the wire request for every existing unscoped caller.
- A whitespace-only branch positional is a usage error printed before daemon connect; rules out forwarding it to the daemon's `invalid_params` guard, which would spend a round trip on a malformed local invocation, and rules out treating blank as omission.
- The branch positional forwards untrimmed once non-blank; rules out CLI-side normalization, since downstream branch matching compares the key exactly (`pipeline_resume`'s handler already forwards untrimmed).
- Refusal output stays the daemon `reason` verbatim on stderr with exit `1`, including branch-scoped refusals carrying `branchKey`/`stageId` detail in the result object; rules out the CLI re-rendering branch refusals into its own sentence, and rules out printing anything on success.
- Arity stays exactly one or two positionals; a third positional is a usage error; rules out silently ignoring trailing arguments.
- `PIPELINE_RESUME_USAGE` gains `[<branch-key>]`, which is also what `jarvis help pipeline resume` renders (`command-tree.ts` reuses the same constant); rules out a separate help string that could drift from the usage error.
- Scope is the CLI admission surface only: the TUI daemon client's resume params and its branch-node behavior are untouched; rules out absorbing the TUI resume surface into this PR.

## Task checklist

- Add a `parsePipelineResumeArgs` helper in `v2/src/commands/pipeline.ts` alongside `parsePipelineDecisionArgs`, returning `{ ok: true; pipelineId: string; branchKey?: string } | { ok: false }`, and call it from the `resume` branch of `runPipelineCommand`.
- Build the `pipeline_resume` params so `branchKey` is present only when supplied, on one stable line.
- Update `PIPELINE_RESUME_USAGE` in `v2/src/cli/usage.ts` to `usage: jarvis pipeline resume <pipeline-id> [<branch-key>]\n`.
- Add branch-forwarding, branch-refusal, and malformed-arity coverage to `v2/src/commands/pipeline.test.ts`, with in-body `// @mutate` directives for the keystone and each added guard on real production lines.
- Update `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `pipeline.test.ts` test `pipeline resume forwards the branch positional as branchKey` fails against the pre-fix code, then proves `jarvis pipeline resume <pipeline-id> <branch-key>` sends exactly one `pipeline_resume` frame whose params are `{ pipelineId, branchKey }` with the branch key untrimmed and unnormalized, and exits `0` with no stdout on `kind: "resumed"`.
- [x] `pipeline.test.ts` test `pipeline resume prints a branch-scoped refusal verbatim on stderr` proves a `{ kind: "refused", pipelineId, branchKey, stageId, reason }` response prints only the daemon `reason` on stderr, writes no stdout, and exits `1`.
- [x] `pipeline.test.ts` test `pipeline resume usage errors reject malformed branch arity before daemon connect` proves a third positional and a whitespace-only branch positional each print `PIPELINE_RESUME_USAGE`, exit `1`, and open no IPC client, and that the usage text names the optional branch positional.
- [x] `pipeline.test.ts` — `pipeline resume forwards the branch positional as branchKey`; Keystone checkpoint: an in-body `// @mutate` directive reverting the params expression on the `resume` branch's `runPipelineMutationCommand` call to the baseline `{ pipelineId: parsed.pipelineId }` drops branch scope from the wire request, turning this test red on the sent-frame assertion while the exit code and empty stdout stay identical.
- [x] `pipeline.test.ts` — `pipeline resume usage errors reject malformed branch arity before daemon connect`; Mutation checkpoint: an in-body `// @mutate` directive widening the resume arity guard to admit a third positional makes the extra-argument case connect to the daemon instead of printing usage, turning this test red.
- [x] `pipeline.test.ts` — `pipeline resume usage errors reject malformed branch arity before daemon connect`; Mutation checkpoint: a second in-body `// @mutate` directive neutering the blank-branch-positional guard so only a zero-length branch key is rejected makes the whitespace-only case send a `pipeline_resume` frame instead of printing usage, turning this test red.
- [x] Existing `pipeline.test.ts` resume tests stay green — `pipeline resume exits 0 on resumed for %s` still asserts the sent frame's params are exactly `{ pipelineId }`, the terminal-refusal, malformed-envelope, missing-argument, and blank-`pipeline-id` cases are unchanged, and `help pipeline resume matches resume usage` and the `help pipeline` summary test stay green against the updated usage constant.
- [x] `v2/docs/write-behavior.md` — the `jarvis pipeline resume` row records the optional branch positional, its arity and blank-key usage errors before daemon connect, and that the RPC carries `branchKey` only when supplied; the resume-vs-run-resume note records branch-scoped refusals printing verbatim.
- [x] `v2/docs/operator-runbook.md` § Pipeline resume shows the `jarvis pipeline resume <pipeline-id> [<branch-key>]` form, states when to use it (an approved branch's stage failed while sibling branches sit at their own gates), that sibling gates and rows are untouched, that a refusal naming the branch's own `awaiting` gate means approve or reject that gate first, and that omitting the branch key keeps whole-pipeline resume.
- [x] `v2/docs/v1-behaviors.md` records the v2 CLI branch-scoped resume form, correcting the existing bullet that describes only `jarvis pipeline resume <pipeline-id>`, and states the unscoped form's request and semantics are unchanged.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline resume` CLI contract row (optional branch positional, usage errors, params sent) and the resume-vs-`run resume` note.
- `v2/docs/operator-runbook.md` — § Pipeline resume: branch-scoped command form, when to use it after an approved branch fails, sibling-gate isolation, own-gate refusal and the approve/reject next step, unscoped form unchanged.
- `v2/docs/v1-behaviors.md` — v2 CLI branch-scoped resume form; correct the CLI resume bullet; unscoped form unchanged.

## Implementer notes

- Keep the arity check, the blank-branch check, and the params expression each on one physical line so all three `@mutate` directives quote unique single-line text.
- Suggested production shape (adjust names, keep the one-line anchors): `if (argv.length < 1 || argv.length > 2) return { ok: false };`, `if (branchKey.trim().length === 0) return { ok: false };`, and `{ pipelineId: parsed.pipelineId, ...(parsed.branchKey !== undefined ? { branchKey: parsed.branchKey } : {}) }`.
- `runPipelineMutationCommand` types `params` as `Record<string, string>`; the spread form keeps that type without widening it to accept `undefined`.
- The pin file's usage-error tests already assert no daemon contact by passing a `connectIpcClient` that throws (see the existing `resume usage error %p prints usage before daemon connect` block) — extend that pattern rather than adding a new harness.
- Reuse `pipelineWaitFrame`/`makeIpcClient`/`ipcFramesWithMethod` and the `withFixedUuid` wrapper from the existing resume describe block; branch-scoped refusal payloads parse through the existing `parsePipelineMutationOutcome`, which reads only `kind` and `reason`, so no envelope-parsing change is needed.
- Add no test-only inversion hooks; every directive must mutate the real CLI guard or params expression.

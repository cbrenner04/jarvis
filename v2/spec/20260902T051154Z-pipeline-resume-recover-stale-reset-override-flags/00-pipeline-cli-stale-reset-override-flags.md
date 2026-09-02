# Pipeline CLI stale-reset override flags

## Primary implementation surface

cli

## Problem

Standalone `plan`/`implement` re-runs accept `--reset-despite-dirty` and `--reset-despite-landed-criteria`; `pipeline resume` and `pipeline recover` expose neither, so operators hand-abandon dirty pipeline worktrees when resume auto-clear or ordinary gates refuse.

## Decision ledger

- Add both override flags to `pipeline resume` (unscoped and branch-scoped) and `pipeline recover` (branch-scoped only); rules out pipeline recovery being the only re-run path with no reset lever on the CLI.
- Resume and recover parsers use `parseArgs` with the same boolean option names as workflow re-runs (`reset-despite-dirty`, `reset-despite-landed-criteria`); rules out inventing pipeline-specific flag spellings.
- Each admitted flag is present on the wire only when true (`resetDespiteDirty` / `resetDespiteLandedCriteria`); rules out always sending false defaults that could change daemon admission semantics for existing callers.
- Resume RPC params widen from `Record<string, string>` only as far as needed to carry optional booleans; rules out stringifying booleans or a parallel ad hoc RPC client.
- Recover forwards both flags to `pipeline_recover` without local stale-reset behavior; rules out inventing recover-side reset preflight in this slice.
- Existing resume/recover positional arity, blank-key usage errors, refusal stdout/stderr contracts, and unscoped `{ pipelineId }` wire shape when no branch or flags are supplied stay unchanged; rules out regressing the branch-scoped resume CLI spec.
- `PIPELINE_RESUME_USAGE`, `PIPELINE_RECOVER_USAGE`, and `jarvis help pipeline resume|recover` name both optional flags; rules out help/usage drift from the admitted grammar.
- Deferred to first consumer: TUI or other non-CLI resume/recover callers surfacing the same flags — pin when a caller needs it.

## Tasks

- Add `PIPELINE_RESUME_PARSE_ARG_OPTIONS` / `PIPELINE_RECOVER_PARSE_ARG_OPTIONS` and help-flag entries reusing the workflow stale-reset override flag metadata from `command-help-flags.ts`.
- Replace `parsePipelineResumeArgs` and `parsePipelineRecoverArgs` with `parseArgs`-based parsers that preserve current positional contracts and admit the two boolean options.
- Thread admitted flags into `pipeline_resume` and `pipeline_recover` RPC params on the resume and recover command paths.
- Extend `pipeline.test.ts` with resume and recover forwarding coverage, flag-independent RPC field assertions, usage/help updates, and mutation checkpoints on the params expressions.
- Keep `daemon-pipeline-resume.test.ts` and `daemon-pipeline-recover.test.ts` green without changing daemon handlers.

## Acceptance criteria

- [x] `pipeline.test.ts` proves `pipeline resume` accepts `--reset-despite-dirty` and `--reset-despite-landed-criteria` on unscoped and branch-scoped invocations, forwards each true flag independently on the `pipeline_resume` frame (`resetDespiteDirty` / `resetDespiteLandedCriteria`), omits absent flags from params, and keeps refusal/usage behavior unchanged when flags are not supplied; fails against the pre-fix flagless CLI path reachable on main today (`ipcFramesWithMethod` params lack override fields).
- [x] `pipeline.test.ts` proves `pipeline recover` accepts `--reset-despite-dirty` and `--reset-despite-landed-criteria`, forwards each true flag independently on the `pipeline_recover` frame, omits absent flags, and keeps existing recover arity/refusal behavior; fails against the pre-fix flagless CLI path reachable on main today.
- [x] `pipeline.test.ts` — `pipeline resume forwards the branch positional as branchKey` and `pipeline resume usage errors reject malformed branch arity before daemon connect` stay green.
- [x] `pipeline.test.ts` — `pipeline recover admits a branch-scoped recovery request` and `pipeline recover rejects malformed arity before daemon connect` stay green.
- [x] `pipeline.test.ts` — `help pipeline resume matches resume usage` and `help pipeline recover matches recover usage` stay green against the updated usage constants naming both override flags.
- [x] `daemon-pipeline-resume.test.ts` and `daemon-pipeline-recover.test.ts` stay green (daemon RPC admission unchanged by this slice).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None in this subspec — operator and v1-parity docs land in later subspecs.

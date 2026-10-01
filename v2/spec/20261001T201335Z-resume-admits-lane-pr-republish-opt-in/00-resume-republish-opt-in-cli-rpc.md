# Resume republish opt-in CLI and RPC admission

## Problem

`jarvis run resume` and `jarvis pipeline resume` always send `{ runId }` / pipeline resume params without `allowLanePrRepublish`, so operators cannot opt in at the supported boundary even though the publisher accepts the field.

## Decisions

- Shared long flag `--allow-lane-pr-republish` on `jarvis run resume <run-id>` and `jarvis pipeline resume` (same spelling on both) — rules out divergent operator names and rules out reusing the internal TypeScript identifier on the CLI.
- When the flag is absent, CLI and RPC omit `allowLanePrRepublish` entirely (do not send `false`) — rules out default-true RPC and rules out tri-state on the wire.
- `resume` and `pipeline_resume` reject params with `allowLanePrRepublish: false` (or any present value other than `true`) before resume side effects — rules out silent ignore of `false` and rules out wire-level “force guard on.”
- When present, both `resume` and `pipeline_resume` RPC payloads include `allowLanePrRepublish: true` — rules out pipeline-only admission.
- `jarvis pipeline recover`, automatic slot redrive, restart recovery, and other non-resume `resume` RPC callers keep today’s params (no opt-in field, no new flag) — rules out bypass on recover and rules out implicit opt-in on internal redrive.
- `pipeline resume --address-review` may combine with `--allow-lane-pr-republish` only when both parse successfully; address-review dispatch does not consume the republish flag (separate RPC) — rules out rejecting the flag globally on pipeline resume.
- Add `RUN_RESUME_PARSE_ARG_OPTIONS` / `RUN_RESUME_HELP_FLAGS` and extend `PIPELINE_RESUME_PARSE_ARG_OPTIONS` / help parity like existing stale-reset booleans — rules out ad hoc argv scanning outside `parseArgs`.

## Task checklist

- [ ] Parse `--allow-lane-pr-republish` in `run.ts` `run resume` and forward through `request(client, "resume", …)`.
- [ ] Parse the same flag in `parsePipelineResumeArgs` and forward through `pipeline_resume` params in `pipeline.ts`.
- [ ] Extend `daemon-pipeline-handlers.ts` `pipeline_resume` param typing and `resumePipeline(…)` options bag only as needed to carry the boolean through to run resume (field may be ignored until subspec 01).
- [ ] Extend `daemon-run-lifecycle-handlers.ts` `resumeHandler` and `pipeline_resume` validation to accept omitted or `allowLanePrRepublish: true` only; reject other values.
- [ ] Add `RUN_RESUME_USAGE` (or equivalent) documenting the flag; update `PIPELINE_RESUME_USAGE` / command-tree help.
- [ ] Do not add the flag to `PIPELINE_RECOVER_PARSE_ARG_OPTIONS`, recover usage, or `pipeline_recover` handler params.

## Acceptance criteria

- [ ] `run.test.ts`: `jarvis run resume <id> --allow-lane-pr-republish` sends `params: { runId, allowLanePrRepublish: true }`; plain `jarvis run resume <id>` sends `params: { runId }` only; fails against pre-fix `{ runId }`-only payloads.
- [ ] `pipeline.test.ts`: `jarvis pipeline resume … --allow-lane-pr-republish` sends `allowLanePrRepublish: true` on `pipeline_resume`; the same command without the flag omits it; fails against pre-fix omission.
- [ ] `pipeline.test.ts`: `jarvis pipeline recover … --allow-lane-pr-republish` errors on usage before daemon connect (flag not in recover parser); forward regression guard only (not a pre-fix-failing new-behavior AC).
- [ ] `pipeline.test.ts`: `jarvis pipeline resume … --address-review --allow-lane-pr-republish` sends address-review RPC params without `allowLanePrRepublish`; any `pipeline_resume` payload on the same invocation still includes `allowLanePrRepublish: true` when resume proceeds — fails against pre-fix if review dispatch swallowed the republish flag.
- [ ] `run.test.ts` or daemon resume tests: RPC `resume` / `pipeline_resume` with `allowLanePrRepublish: false` is rejected without resume side effects — fails against pre-fix silent accept.
- [ ] `help-flags-parity.test.ts` (or equivalent help coverage) lists `--allow-lane-pr-republish` on run resume and pipeline resume help surfaces.
- [ ] `bun run typecheck` and `bun run test:v2` pass for touched surfaces.

## Documentation updates

- None in this subspec (operator-facing prose lands in subspec 01 with the end-to-end behavior).

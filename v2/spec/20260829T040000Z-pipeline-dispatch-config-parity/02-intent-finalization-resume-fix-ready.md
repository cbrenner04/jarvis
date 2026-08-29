# Intent-finalization resume fix/ready source

## Problem

`inertResumeWriteLoopInput` (`v2/src/execution/workflow-runner.ts:3478–3479`) resolves `fixCommand` and `readyCommand` via `readProjectFixCommand(context.project)` / `readProjectReadyCommand(context.project)` — the default `MACHINE_CONFIG_PATH` — so intent-finalization resume after a pipeline-dispatched write step uses the wrong commands when admission used a non-default config path. Reachable on main: `resolveIntentFinalizationResumeContext` admits from the review row and calls `inertResumeWriteLoopInput` without any `configPath` on `IntentFinalizationResumeContext`.

## Decision ledger

- Resolve fix/ready for the inert resume stub from the durable write-sibling row admitted under the same workflow invocation — read stamped `fixCommand`/`readyCommand` from `writeRun.queuedInput` when present, otherwise from the stamped write step on the shared workflow snapshot; rules out threading a new `configPath` through `IntentFinalizationResumeContext` and rules out re-reading default `MACHINE_CONFIG_PATH`.
- Scope the change to fix/ready command resolution in `inertResumeWriteLoopInput` only; bounds and review timeouts on the inert stub stay unchanged.
- Depends on subspec 01 stamping fix/ready onto dispatched write steps so the write-sibling row or snapshot carries the admission config values.

## Task checklist

- Replace default-path `readProjectFixCommand` / `readProjectReadyCommand` in `inertResumeWriteLoopInput` with write-sibling stamped command resolution (pass `writeRun` from `resolveReviewRowHead` / call sites).
- Add `workflow-runner-resume.test.ts` coverage admitting a write step under a non-default machine config.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] A test in `v2/src/execution/workflow-runner-resume.test.ts` seeds a failed intent review resume whose write-sibling was admitted under a non-default machine config (`readyCommand`/`fixCommand` distinct from defaults) and asserts intent-finalization resume uses those stamped commands, not default-path lookup; it fails against the pre-fix `readProjectFixCommand(context.project)` / `readProjectReadyCommand(context.project)` path. `v2/src/execution/workflow-runner-resume.test.ts` — `intent-finalization resume uses write-sibling stamped fix and ready commands`; Mutation checkpoint: its test body carries a `// @mutate` directive replacing the landed write-sibling command resolution in `inertResumeWriteLoopInput` with the pre-fix `readProjectFixCommand(context.project)` / `readProjectReadyCommand(context.project)` calls, and the mutation turns that test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — subspec 01 already documents pipeline dispatch stamping; this subspec closes an internal resume seam only.

## Implementer notes

- `resolveIntentFinalizationResumeContext` already resolves `writeRun` via `resolveReviewRowHead`; thread stamped commands from that head into `inertResumeWriteLoopInput` rather than adding fields to `IntentFinalizationResumeContext`.
- If workflow write rows do not persist `queuedInput` today, read stamped `fixCommand`/`readyCommand` from the snapshot write step once subspec 01 carries them on admitted steps / `buildWorkflowSnapshot`; keep the `@mutate` anchor on the default-path `readProjectFixCommand` call site in `inertResumeWriteLoopInput`.

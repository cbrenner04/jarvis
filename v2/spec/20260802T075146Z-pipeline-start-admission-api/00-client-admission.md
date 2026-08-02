# Client admission API

## Problem

- `jarvis pipeline start` owns reusable admission policy alongside terminal presentation and waiting.

## Decisions

- Export a presentation- and terminal-I/O-free API that accepts a project key and a discriminated, exclusive `seedPath` or `seedText` input; it is allowed to read the filesystem and use IPC.
- Its result is a discriminated union: `{ kind: "admitted", pipelineId }`, a named `{ kind: "pre-admission-failure", failure, detail }`, or a named post-validation admission failure with `detail`. `detail` preserves the current operator-facing message; callers branch on `kind`/`failure`, never parse it.
- Named pre-admission failures cover unregistered project, missing pipeline, configuration-read exception, missing/invalid machine-model configuration, invalid project pipeline, invalid seed input, and invalid seed path. Daemon refusal, malformed `pipeline_start` success, RPC/transport failure, and connection or auto-start lifecycle failure are separately named admission failures with their current rendered detail.
- The API owns the point at which its narrow connection/dispatch dependency is invoked: it validates first, then opens one existing auto-start-capable daemon connection and issues one `pipeline_start`. Pre-admission failure neither connects nor dispatches; daemon-handler changes are excluded.
- The dependency surface is limited to registry/config/seed-resolution inputs, pipeline resolution, and connection/request operations; it excludes argv parsing, `Io`, output formatting, detach state, and wait operations.
- Seed-path resolution uses the injected invocation `cwd`, not the project root: preserve the original relative seed value in context after regular-file, readable, realpath containment checks against the registered project root. Exclusivity is compile-time by the input union and runtime-validated at this public boundary; neither/both rejects before connection.
- Return immediately after `pipeline_start`; `pipeline_wait` and completion interpretation remain callers’ work. TUI integration is deferred.

## Task checklist

- Extract the admission input/result types, narrow dependency seam, validation, context construction, and `pipeline_start` dispatch from `v2/src/commands/pipeline.ts` into a focused v2 client-admission module.
- Preserve the existing auto-start-capable connection lifecycle behind the injected seam while making pre-admission rejection connection-free.
- Add direct API coverage for both seed variants, typed failures, request definition/context, dispatch and connection counts, and all response/failure result variants.
- Move rejection coverage to the extracted guards and add source-mutation directives without production inversion hooks.
- Document the shared pre-admission boundary and CLI-owned waiting.

## Acceptance criteria

- [ ] New `v2/src/commands/pipeline-start-admission.test.ts` fails against the pre-extraction code and directly admits both seed variants as `{ kind: "admitted", pipelineId }`; each success opens one connection, sends exactly one `pipeline_start`, sends no `pipeline_wait`, and asserts the resolved definition plus context `cwd`, exclusive original `seed`/`seedPath`, `configPath`, and registry snapshot.
- [ ] `v2/src/commands/pipeline-start-admission.test.ts` proves each named pre-admission failure—unregistered project, absent/invalid pipeline, configuration-read exception, missing/invalid model config, invalid seed union, and invalid seed path—preserves current detail and performs neither connection nor RPC; it fails against the prior handler-only admission path.
- [ ] `v2/src/commands/pipeline-start-admission.test.ts` proves named daemon refusal, malformed `pipeline_start` success, RPC/transport failure, and connection/auto-start lifecycle failure preserve current detail without a pipeline ID.
- [ ] `v2/src/commands/pipeline.test.ts` seed-path tests `admits --seed as context.seedPath without inlining file content`, `rejects --seed %p before daemon connect`, `rejects unreadable --seed file before daemon connect`, `rejects --seed outside registered project root before daemon connect`, and `rejects --seed symlink escape outside registered project root before daemon connect` stay green (relative-cwd resolution, regular-file/readability, containment, symlink escape, and original-value preservation unchanged).
- [ ] Every added or moved rejection guard has a valid `// @mutate` source-replacement directive in `v2/src/commands/pipeline-start-admission.test.ts`; applying each directive makes its focused test fail, and every refusal case proves no connection or RPC. No production inversion hooks are added.

## Documentation updates

- `v2/docs/write-behavior.md` — shared pre-admission contract, invocation-cwd seed resolution, and CLI-owned attach/wait boundary.

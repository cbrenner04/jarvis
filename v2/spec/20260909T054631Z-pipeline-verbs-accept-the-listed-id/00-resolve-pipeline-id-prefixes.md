# 00 - Resolve pipeline id prefixes in the daemon and print unique prefixes

## Problem

`renderPipelineListRows` (`v2/src/commands/pipeline.ts`) prints `pipelineId.slice(0, 8)`; every pipeline verb passes the operator's argument straight to the store (`daemon-pipeline-handlers.ts`: approve/reject, resume, recover, dismiss/undismiss, wait), which matches full ids only. The truncated id fails as `pipeline_not_found` — the same reason a genuinely absent pipeline returns — and recovery is `pipeline list --json` piped through a JSON parser.

## Decisions

- One daemon-side resolver, `resolvePipelineIdArgument(store, argument)`, runs before every pipeline verb's store call: an exact `pipelineId` wins; otherwise an argument of at least eight characters that is a strict prefix of exactly one pipeline id (dismissed pipelines included) resolves to it; rules out per-verb divergence and a CLI-side extra round trip.
- A prefix matching two or more pipelines refuses with reason `pipeline_id_ambiguous`, and the message lists every candidate id; rules out acting on the wrong pipeline.
- An argument matching nothing keeps each verb's existing not-found reason and message unchanged; rules out a new failure vocabulary for the ordinary absent case.
- The human `pipeline list` first column prints the shortest prefix, never shorter than eight characters, that is unique among the pipelines in that listing; rules out printing two indistinguishable ids when eight characters collide. `--json` keeps the full `pipelineId` field unchanged.
- Arguments shorter than eight characters never prefix-resolve, so a stray one-character argument cannot select a pipeline.

## Tasks

- Add the resolver next to the pipeline handlers; thread it through approve, reject, resume, recover, dismiss, undismiss, and wait.
- Replace `slice(0, 8)` with a unique-prefix renderer computed over the listed snapshot.
- Tests: CLI listing → dismiss round trip in `pipeline.test.ts` or `daemon-pipeline-dismiss.test.ts`; ambiguity refusal; not-found unchanged; `--json` shape unchanged; unique-prefix lengthening on an eight-character collision.

## Acceptance criteria

- [x] A test proves the first column of `pipeline list` human output is accepted verbatim by `pipeline dismiss`; it fails against the current `slice(0, 8)` rendering.
- [x] A test proves a strict prefix of exactly one pipeline id resolves for `pipeline dismiss` and `pipeline wait`, while an argument matching no pipeline still returns the verb's existing not-found reason.
- [x] A test proves an ambiguous prefix (two pipelines sharing it) refuses with `pipeline_id_ambiguous`, names both candidates, and dismisses neither.
- [x] A test proves two pipelines sharing their first eight characters are listed with distinct, longer prefixes, and that an argument shorter than eight characters never resolves.
- [x] `pipeline list --json` continues to emit the full `pipelineId` field unchanged.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline list and wait: verbs accept the listed prefix or the full id; ambiguous prefixes refuse with the candidates; drop the `--json`-parsing workaround.
- `v2/docs/daemon-host.md` — pipeline verb refusal reasons: add `pipeline_id_ambiguous` and the prefix-resolution rule.

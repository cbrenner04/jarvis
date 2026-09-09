# `pipeline list` prints an 8-character id that every sibling verb rejects

## Problem

`renderPipelineListRows` (`v2/src/commands/pipeline.ts:462`) renders `pipeline.pipelineId.slice(0, 8)` as the first column of the human listing. No pipeline verb resolves a prefix, so copying the id the listing just printed into the adjacent verb fails:

```text
$ jarvis pipeline list
316bb8f2  full-review  failed  subspec-inventory-relativizes-against-the-wrong-root.md  1d  …

$ jarvis pipeline dismiss 316bb8f2
pipeline_not_found

$ jarvis pipeline dismiss 316bb8f2-5d42-469f-9890-514887557d92
pipeline dismiss: 316bb8f2-5d42-469f-9890-514887557d92
```

Observed 2026-09-07 dismissing two stale pipelines; both attempts failed, and recovery was `pipeline list --json` piped through a JSON parser to read `pipelineId`. The `--json` field is `pipelineId` while the human column is unnamed and truncated, so the human listing is not a usable input to anything.

`jarvis run list` prints full run uuids, and `run dismiss` accepts them. This is the same "pipeline CLI is not like run list" asymmetry as [[pipeline-cli-discovers-daemons-like-run-list]], on the display side rather than the transport side, and the same shape as the recorded `stageId`-vs-`id` gotcha: the operator is handed one identifier and the verb wants a different one.

`pipeline_not_found` is also the same reason string a genuinely absent pipeline returns, so a truncation mistake is indistinguishable from a pipeline that no longer exists.

## Decisions

- The human `pipeline list` first column is an identifier some pipeline verb accepts verbatim — either the full `pipelineId` or a prefix the verbs resolve; rules out a listing whose output cannot be fed to the adjacent command.
- If prefix resolution is chosen, an ambiguous prefix refuses with a named reason listing the matches rather than acting on one; rules out a silent wrong-pipeline mutation.
- A verb given an id that matches no pipeline but is a strict prefix of exactly one reports that distinctly from `pipeline_not_found`; rules out a truncation mistake presenting as an absent pipeline.
- Scope is the pipeline verbs' id handling only; rules out changing `run list` rendering or the `--json` shape.

## Acceptance criteria

- [ ] A test proves the first column of `pipeline list` human output is accepted verbatim by `pipeline dismiss`; it fails against the current `slice(0, 8)` rendering.
- [ ] A test proves an id matching no pipeline but strictly prefixing exactly one reports a reason distinct from `pipeline_not_found`.
- [ ] A test proves an ambiguous prefix (two pipelines sharing it) refuses and names both candidates rather than mutating either.
- [ ] `pipeline list --json` continues to emit the full `pipelineId` field unchanged.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline list and wait: state which identifier the verbs accept, and delete the `--json`-parsing workaround if prefix resolution lands.

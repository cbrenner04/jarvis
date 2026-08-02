# CLI adapter

## Problem

- The extraction must not change the operator-visible `jarvis pipeline start` contract.

## Decisions

- Keep argv parsing and its neither/both seed-flag refusal in the CLI adapter; pass only a valid exclusive seed input to client admission.
- Adapt typed admission results to the current stderr detail, pipeline-ID stdout, detach branching, attached `pipeline_wait` loop, terminal JSON, SIGINT handling, and exit selection.
- Preserve the established connection and auto-start behavior through the admission seam; the adapter must not duplicate admission validation, definition resolution, request construction, or daemon-response parsing.

## Task checklist

- Refactor `runPipelineStartCommand` into an argv/terminal adapter over the client-admission API.
- Keep the current attached and detached launch behavior, refusal rendering, malformed-response handling, and connection/lifecycle error rendering.
- Preserve the existing pipeline-start regression coverage and record the v2 behavior catalog entry.

## Acceptance criteria

- [x] `v2/src/commands/pipeline.test.ts` pipeline-start attached, detached, seed-path, seed-text, and refusal tests stay green after the adapter extraction.
- [x] `v2/src/commands/pipeline.test.ts` tests `prints admitted pipeline ID on valid start`, `--detach exits 0 after admission without pipeline_wait`, and `attached start waits through awaiting-approval to terminal JSON and exit code` stay green: output, detach behavior, attached wait, terminal JSON, and exit selection are unchanged.
- [x] `v2/src/commands/pipeline.test.ts` tests `failed daemon admission exits non-zero with stderr detail and no pipeline ID on stdout` and `operator abort during attached start reports stderr detail without boundary JSON` stay green; daemon refusal and attached abort rendering remain unchanged.
- [x] `v2/src/commands/pipeline-start-admission.test.ts` and the pipeline-start coverage in `v2/src/commands/pipeline.test.ts` pass after the refactor, and `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — v2 `pipeline start` preserves its CLI contract through the reusable client-admission path.

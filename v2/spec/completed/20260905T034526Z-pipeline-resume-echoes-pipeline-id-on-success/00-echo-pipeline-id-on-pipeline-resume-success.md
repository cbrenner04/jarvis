# Echo pipeline id on pipeline resume success

## Problem

`jarvis pipeline resume <id>` exits `0` on `kind: "resumed"` but prints nothing, so operators cannot confirm admission or capture the id for `pipeline wait` / `pipeline list`. `pipeline start` already echoes the admitted pipeline id on stdout; the daemon returns `pipelineId` in the resumed frame and the CLI discards it.

## Decision ledger

- Echo the daemon-returned `pipelineId` plus `\n` on stdout when `pipeline resume` succeeds (`kind: "resumed"`), matching `pipeline start`'s id-on-stdout convention; rules out silent success and echoing the CLI positional when it differs from the daemon value.
- Leave refusal exit codes and stderr `reason` wording unchanged; rules out coupling this to the refusal path.
- Scope stdout echo to `successKind: "resumed"` only; rules out folding `approve` / `reject` silent-success into this change.
- Parse `pipelineId` from the daemon resumed envelope in `parsePipelineMutationOutcome`; rules out reusing the CLI positional without reading the frame.
- Daemon contract is unchanged; rules out `pipeline_resume` handler edits.

## Task checklist

- Extend `parsePipelineMutationOutcome` and the resumed branch of `PipelineMutationOutcome` so a `kind: "resumed"` envelope with a non-empty `pipelineId` parses through; a resumed shape without `pipelineId` stays `invalid daemon response`.
- In `runPipelineMutationCommand`, when `successKind` is `"resumed"` and the parsed outcome is resumed, write `${pipelineId}\n` to stdout before returning `0`.
- Update `pipeline.test.ts` test `pipeline resume exits 0 on resumed for %s` to assert daemon-returned `pipelineId` on stdout and exit `0` (fails against the current `stdout: ""` pin).
- Update other `pipeline resume` success pins that still expect empty stdout (`pipeline resume forwards the branch positional as branchKey`, `pipeline resume forwards stale-reset override flags …`) to expect the daemon-returned id line.
- Update `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `pipeline.test.ts` test `pipeline resume exits 0 on resumed for %s` fails against the pre-fix `stdout: ""` pin, then asserts daemon-returned `pipelineId` on stdout and exit `0`.
- [x] `pipeline.test.ts` — `pipeline resume on terminal pipeline prints %s on stderr` stays green.
- [x] `pipeline.test.ts` — `pipeline resume prints a branch-scoped refusal verbatim on stderr` stays green.
- [x] `pipeline.test.ts` — `pipeline %s exits 0 on applied decision and sends branch-keyed IDs` stays green.
- [x] `pipeline.test.ts` — `pipeline reject prints invalid_decision on stderr with no success stdout` stays green.
- [x] `v2/docs/write-behavior.md` — the `jarvis pipeline resume` row and the resume-vs-run-resume note record id-on-stdout on success instead of silent success.
- [x] `v2/docs/operator-runbook.md` — § Pipeline resume notes success echoes the pipeline id on stdout.
- [x] `v2/docs/v1-behaviors.md` — the pipeline-resume bullet records id-on-stdout on success instead of silent success.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline resume` CLI contract row and resume-vs-run-resume note.
- `v2/docs/operator-runbook.md` — § Pipeline resume success stdout.
- `v2/docs/v1-behaviors.md` — pipeline-resume CLI bullet.

## Implementer notes

- `pipeline start` echoes with `io.stdout(\`${admission.pipelineId}\n\`)` — match that shape, not the dismiss/recover confirmation prefixes.
- Reuse the raw daemon `result.response` record (or the parsed outcome) for the echoed id; do not substitute `params.pipelineId` from the outbound RPC.
- `runPipelineMutationCommand` is shared with approve/reject; gate the stdout write on `successKind === "resumed"` so applied decisions stay silent.
- Branch-forwarding and stale-reset success tests mock `{ kind: "resumed", pipelineId: "pipe-1" }`; their stdout pins must expect `pipe-1\n` after this change.

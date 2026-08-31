# `jarvis pipeline resume` succeeds silently — no pipeline id on stdout

## Problem

`jarvis pipeline resume <id>` exits 0 on success but prints nothing. `runPipelineMutationCommand` (`v2/src/commands/pipeline.ts:502`) returns the success exit code without any stdout write — only refusals print (to stderr). So the operator gets no confirmation the resume was admitted and can't capture the pipeline id for a follow-up `pipeline wait`/`list`, unlike `pipeline start`, which echoes `${admission.pipelineId}` on stdout (`pipeline.ts:220`). The daemon already returns `pipelineId` in the `{ kind: "resumed", pipelineId }` frame (`pipeline.test.ts:1538`), so the value is in hand — it just isn't surfaced.

## Decisions

- On `pipeline resume` success, echo the pipeline id on stdout (matching `pipeline start`'s id-on-stdout convention) so the result is scriptable and confirmable. Rules out a silent success.
- Keep exit codes and stderr refusal wording unchanged. Rules out coupling this to the refusal path.

## Acceptance criteria

- [ ] A CLI test proves `pipeline resume` on a `resumed` outcome writes the pipeline id to stdout and still exits 0; it fails against the current silent-success path.
- [ ] Refusal and terminal-pipeline cases still print the daemon reason on stderr and exit non-zero, unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `pipeline resume` section notes it echoes the pipeline id on success.

## Sequencing

P3 — really low priority; a scriptability/ergonomics gap, no correctness impact. Sibling verbs `approve`/`reject` share the same silent-success shape; fold them in if convenient, but resume is the one that motivates a follow-up `pipeline wait`.

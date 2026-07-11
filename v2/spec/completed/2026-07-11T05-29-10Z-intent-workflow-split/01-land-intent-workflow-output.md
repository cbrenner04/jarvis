# Land intent workflow output

Add a preset-aware workflow completion boundary that validates and lands split output before workflow publication.

## Decisions

- Use `.jarvis-intent-stage/` as the step artifact and require at least one validated Markdown file for step completion; rule out directory existence or partial output as success.
- Run intent validation and landing after the sole write step completes but before workflow-level commit/publish; rule out step publication, post-publication validation, or marking the workflow complete first.
- Require the v1-compatible worktree boundary before landing: only `.jarvis-intent-stage/**` may differ from the base; rule out committing arbitrary model edits.
- Land the complete set transactionally under the resolved durable `ready-intents/`; on any filesystem failure, restore the pre-run destination and retain staging for retry; rule out collision preflight as sufficient atomicity.
- Remove staging only after successful landing and commit only the invocation-owned durable files; rule out publishing staging artifacts.
- Record landed filenames against the workflow invocation; retry accepts byte-identical files owned by that invocation and rejects unrelated or differing destination files; rule out overwriting collisions or failing on the workflow's own output.
- Validation, boundary, collision, or landing failure leaves the step completed but the workflow failed at `pre-publication`, retains staging, publishes nothing, and reports the offending path plus rerun guidance; rerun retries only this boundary before publication — rule out an ambiguous completed/non-published state or another model pass.
- Pass the durable `ready-intents/` path as publisher `specPath`; rule out staging paths or an arbitrary emitted file representing the completion commit and PR.
- A one-behavior seed may land one file; rule out a minimum fan-out above one.

## Task checklist

- Add the preset-aware pre-publication hook and durable boundary state.
- Implement boundary checking, transactional landing/rollback, ownership-aware collision handling, and retry.
- Cover validation, rogue edits, collisions, mid-operation failure, resume, and publisher ordering.

## Acceptance criteria

- [x] The intent step completes only when `.jarvis-intent-stage/` contains at least one shared-contract-valid Markdown intent.
- [x] Before landing, changes outside `.jarvis-intent-stage/**` fail with named paths, retained staging, failed `pre-publication` workflow state, rerun guidance, and no publication.
- [x] Valid output lands all-or-nothing under the resolved durable `ready-intents/`; a mid-operation failure restores prior destination contents and leaves staging retryable.
- [x] Successful landing removes `.jarvis-intent-stage/` before publication, whose commit contains only the invocation-owned durable intent files.
- [x] Resume after validation or landing failure retries pre-publication without another agent invocation; identical files previously landed by that workflow succeed idempotently, while unrelated or differing collisions fail without overwrite.
- [x] A valid single-intent stage can complete with one durable file.
- [x] Commit/push/PR publication cannot start until the full set is validated and durably landed.
- [x] Publication receives the durable `ready-intents/` directory as `specPath`.

## Documentation updates

- `v2/docs/workflow-runner.md` — document preset-aware pre-publication ordering, failure state, and resume contract.

# Land reviewed-intent output

Durably land reviewed output from the resolved workspace and publish only where Git applies.

## Decisions

- Keep split staging and deferred landing in the resolved workspace — rules out relocating reviewed output into the operator checkout before landing.
- Preserve landing-only resume after successful review — rules out rerunning critic or actuator when retrying deferred landing.
- Persist a named landing cause with `invocation_failure` — rules out retaining only a transient failure message that cannot support retry diagnosis.
- Separate durable landing from Git commit, push, and PR publication — rules out treating no publication as proof that a git-disabled run completed.

## Tasks

- Stage reviewed output and run post-review deferred landing in the derived workspace.
- Preserve reviewed-intent completion after successful landing, publish configured git-enabled output, and retain landing diagnostics on failure.
- Support landing-only retry from compatible staged, verdict, and checkpoint state without rerunning review.
- Align the operator workflow and v1 parity docs.

## Acceptance criteria

- [ ] A successfully reviewed git-enabled intent durably lands from the resolved split workspace and publishes its configured destination through the applicable commit, push, and PR operations in that workspace.
- [ ] A successfully reviewed git-disabled intent durably lands its output at the configured local destination from the resolved split workspace and performs no Git or GitHub publication.
- [ ] After review succeeds, retry resumes deferred landing from compatible staged, verdict, and checkpoint state without rerunning critic or actuator.
- [ ] Deferred reviewed-intent landing failure returns `invocation_failure` with a persisted named landing cause suitable for retry diagnostics.
- [ ] `v2/docs/first-workflow-walkthrough.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` document reviewed-intent staging, durable landing, Git publication, and landing-failure behavior.

## Documentation updates

- Update `v2/docs/first-workflow-walkthrough.md`.
- Update `v2/docs/workflow-runner.md`.
- Update `v2/docs/v1-behaviors.md`.
